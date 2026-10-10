#!/usr/bin/env python3
"""Fail-closed Phase 16 deploy snapshot and comparison of the live container runtime.

The captured environment contains secrets. It stays on the self-hosted runner
under owner-only permissions, never in GitHub artifacts, logs or commit history.
"""
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile


def docker(*arguments):
    return subprocess.check_output(["docker", *arguments], text=True, stderr=subprocess.DEVNULL)


def snapshot(service, github_output):
    running = json.loads(docker("inspect", "--type", "container",
                                "--format", "{{json .}}", service))
    if not running["State"]["Running"]:
        raise RuntimeError("Cannot snapshot a stopped production container")
    environment = {}
    for item in running["Config"]["Env"]:
        key, separator, value = item.partition("=")
        if not separator or not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", key):
            raise RuntimeError("Running container has an unsupported environment key")
        if "\n" in value or "\r" in value or "\x00" in value:
            raise RuntimeError("Running container environment cannot be represented safely")
        environment[key] = value
    # A Compose reconstruction cannot safely restore an unmodeled live
    # command override, published port, privileged container or custom mount.
    image = json.loads(docker("image", "inspect", "--format", "{{json .}}",
                              running["Image"]))
    for name in ("Cmd", "Entrypoint"):
        if (running["Config"].get(name) or None) != (image["Config"].get(name) or None):
            raise RuntimeError("Live command/entrypoint differs from the retained image")
    host = running["HostConfig"]
    if host.get("PortBindings") or host.get("Privileged") or host.get("ReadonlyRootfs"):
        raise RuntimeError("Live host settings cannot be reconstructed by the bounded rollback")
    for mount in running["Mounts"]:
        if mount["Type"] != "volume" or not mount.get("RW", False):
            raise RuntimeError("Live mount type/access is outside known-good rollback scope")
    networks = sorted(running["NetworkSettings"]["Networks"])
    mounts = sorted(
        [{"type": mount["Type"],
          "name": mount.get("Name", "") if mount["Type"] == "volume" else mount["Source"],
          "destination": mount["Destination"]}
         for mount in running["Mounts"]],
        key=lambda m: (m["destination"], m["type"], m["name"]))
    record = {
        "environment": environment,
        "networks": networks,
        "mounts": mounts,
        "restart": running["HostConfig"]["RestartPolicy"]["Name"]
    }
    directory = Path(tempfile.mkdtemp(prefix="phase16-known-good-"))
    directory.chmod(0o700)
    try:
        metadata = directory / "runtime.json"
        metadata.write_text(json.dumps(record, sort_keys=True))
        metadata.chmod(0o600)
        # Compose single-quoted values are literal: a '$' in a secret must
        # not be expanded again by docker compose --env-file.
        envfile = directory / "compose.env"
        with envfile.open("w") as output:
            for key, value in sorted(environment.items()):
                escaped = value.replace("\\", "\\\\").replace("'", "\\'")
                output.write(f"{key}='{escaped}'\n")
        envfile.chmod(0o600)
        with open(github_output, "a") as output:
            output.write(f"snapshot_dir={directory}\n")
    except Exception:
        shutil.rmtree(directory)
        raise


def verify(service, desired_env, snapshot_dir):
    folder = Path(snapshot_dir)
    assert folder.is_dir() and folder.stat().st_mode & 0o077 == 0, (
        "Previous-runtime snapshot is unavailable or not private")
    record = json.loads((folder / "runtime.json").read_text())
    project = service
    def config(env_path):
        return json.loads(docker(
            "compose", "--project-name", project, "--env-file", str(env_path),
            "-f", "docker-compose.yml", "config", "--format", "json"))
    desired = config(desired_env)
    frozen = config(folder / "compose.env")
    # The existing single-service deployment has no command, entrypoint,
    # port publishing, bind mount or special security/network options. Refuse
    # unmodeled fields rather than incorrectly certifying the old runtime.
    allowed_service = {"image", "container_name", "restart", "environment",
                       "volumes", "networks"}
    if set(desired["services"]) != {service} or set(frozen["services"]) != {service}:
        raise RuntimeError("Unexpected additional Compose service")
    for configuration in (desired, frozen):
        service_config = configuration["services"][service]
        if set(service_config) - allowed_service:
            raise RuntimeError("Unmodeled Compose runtime overrides")
        if service_config.get("container_name") != service:
            raise RuntimeError("Compose changed the running container name")
        if service_config.get("image") != service + ":latest":
            raise RuntimeError("Compose changed the expected image tag")
        values = service_config.get("environment", {})
        for key, value in values.items():
            if record["environment"].get(key) != str(value):
                raise RuntimeError("Deployment environment differs from the running known-good configuration")
        keys = set(values)
        # A removed runtime setting is a configuration change too.
        prefixes = ("SURVEYOR_", "ConnectionStrings__", "MapAssets__",
                    "MapImport__", "ToolHost__", "Surveyor__")
        for key in record["environment"]:
            if key.startswith(prefixes) and key not in keys:
                raise RuntimeError("Deployment removed an existing application setting")
        attachments = service_config.get("networks", {})
        if not isinstance(attachments, dict) or any(
                value not in (None, {}) for value in attachments.values()):
            raise RuntimeError("Unmodeled Compose per-network options")
        wanted_networks = sorted(
            configuration["networks"][key]["name"] for key in attachments)
        if any(not configuration["networks"][key].get("external", False)
               for key in attachments):
            raise RuntimeError("Production backend networks must be external")
        if wanted_networks != record["networks"]:
            raise RuntimeError("Deployment network attachments differ from running service")
        wanted_mounts = []
        for mount in service_config.get("volumes", []):
            if set(mount) - {"type", "source", "target", "read_only", "volume"}:
                raise RuntimeError("Unmodeled Compose mount options")
            if mount["type"] != "volume" or mount.get("read_only", False):
                raise RuntimeError("Unsafe mount type or changed access mode")
            if mount.get("volume") not in (None, {}, {"nocopy": False}):
                raise RuntimeError("Unmodeled Compose volume options")
            name = configuration["volumes"][mount["source"]]["name"]
            wanted_mounts.append({
                "type": "volume", "name": name,
                "destination": mount["target"]
            })
        wanted_mounts.sort(key=lambda m: (m["destination"], m["type"], m["name"]))
        if wanted_mounts != record["mounts"]:
            raise RuntimeError("Deployment mounts differ from the known-good container")
        if service_config.get("restart", "no") != record["restart"]:
            raise RuntimeError("Deployment restart policy differs from the running service")

    # Only after BOTH configurations have been validated against the actual
    # live runtime: retain an independent private rollback Compose definition.
    # This is the preflight-verified source, not the mutable candidate checkout.
    rollback_file = folder / "rollback.compose.yml"
    frozen_source = Path("docker-compose.yml").read_bytes()
    if rollback_file.exists():
        if rollback_file.read_bytes() != frozen_source:
            raise RuntimeError("The previously verified rollback definition changed")
    else:
        with rollback_file.open("xb") as output:
            output.write(frozen_source)
        rollback_file.chmod(0o600)


def main():
    action = sys.argv[1]
    if action == "snapshot" and len(sys.argv) == 4:
        snapshot(sys.argv[2], sys.argv[3])
    elif action == "verify" and len(sys.argv) == 5:
        verify(sys.argv[2], sys.argv[3], sys.argv[4])
    elif action == "cleanup" and len(sys.argv) == 3:
        directory = Path(sys.argv[2])
        if not directory.name.startswith("phase16-known-good-") or not directory.is_dir():
            raise RuntimeError("Refusing to remove an unexpected deployment path")
        shutil.rmtree(directory)
    else:
        raise RuntimeError("Invalid deployment runtime-snapshot action")


if __name__ == "__main__":
    try:
        main()
    except (KeyError, ValueError, OSError, AssertionError, RuntimeError, subprocess.CalledProcessError):
        # Deliberately redact details: docker inspect/compose may include secrets.
        print("Deployment runtime capture/verification failed; check retained image and operator configuration", file=sys.stderr)
        sys.exit(1)

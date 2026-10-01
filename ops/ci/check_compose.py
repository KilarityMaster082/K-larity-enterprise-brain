# Owner task: EB-18 Docker Compose dev stack
"""Static checks for deploy/docker-compose.yml (no Docker needed, so CI and laptops without it can run them).

Fails when: an image is unpinned (no tag, or ``latest``); a published port is not bound to 127.0.0.1; a
password/secret/key environment value is written in the file instead of ``${VAR:?...}``; a service that holds state
has no healthcheck; a ``depends_on`` names a missing service; a named volume is used but not declared; or a variable
the compose file requires is missing from the env generator (so ``make dev-up`` would fail on a fresh checkout).
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[2]
COMPOSE = ROOT / "deploy" / "docker-compose.yml"
SECRETISH = re.compile(r"(PASSWORD|PASSWD|PWD|SECRET|API_KEY|PRESHARED|TOKEN|AUTH)", re.I)
STATEFUL = {"postgres", "keycloak", "openfga", "qdrant", "opensearch", "valkey", "temporal", "seaweedfs"}
ONE_SHOT = {"migrate", "openfga-migrate"}
VAR = re.compile(r"\$\{([A-Z0-9_]+)(:\?[^}]*)?\}")


def _env_items(service: dict) -> list[tuple[str, str]]:
    env = service.get("environment") or {}
    if isinstance(env, list):
        env = dict(item.split("=", 1) for item in env if "=" in item)
    return [(str(k), "" if v is None else str(v)) for k, v in env.items()]


def check(compose: dict, generated_vars: set[str]) -> list[str]:
    problems: list[str] = []
    services = compose.get("services") or {}
    declared_volumes = set((compose.get("volumes") or {}).keys())
    required: set[str] = set()

    for name, svc in services.items():
        image = svc.get("image", "")
        tag = image.rsplit(":", 1)[1] if ":" in image.rsplit("/", 1)[-1] else ""
        if not tag or tag == "latest":
            problems.append(f"{name}: image {image!r} must be pinned to a version tag")

        for port in svc.get("ports") or []:
            if not str(port).startswith("127.0.0.1:"):
                problems.append(f"{name}: port {port!r} must be bound to 127.0.0.1")

        for key, value in _env_items(svc):
            if SECRETISH.search(key) and not key.endswith(("_METHOD", "_MODE")) and not VAR.search(value):
                problems.append(f"{name}: {key} must come from ${{VAR:?}} interpolation, not a literal")
        blob = yaml.safe_dump(svc)
        for m in VAR.finditer(blob):
            if m.group(2):
                required.add(m.group(1))

        command = svc.get("command") or []
        command = command.split() if isinstance(command, str) else [str(c) for c in command]
        for flag, value in zip(command, command[1:]):
            if SECRETISH.search(flag.lstrip("-").replace("require", "")) or flag in ("--requirepass", "--password"):
                if not VAR.search(value):
                    problems.append(f"{name}: command argument {flag} must come from ${{VAR:?}} interpolation, not a literal")

        if name in STATEFUL and name not in ONE_SHOT and "healthcheck" not in svc:
            problems.append(f"{name}: stateful service needs a healthcheck")

        deps = svc.get("depends_on") or {}
        for dep in (deps.keys() if isinstance(deps, dict) else deps):
            if dep not in services:
                problems.append(f"{name}: depends_on unknown service {dep!r}")

        for vol in svc.get("volumes") or []:
            src = str(vol).split(":", 1)[0]
            if not src.startswith((".", "/", "~")) and src not in declared_volumes:
                problems.append(f"{name}: volume {src!r} is not declared")

    for var in sorted(required - generated_vars):
        problems.append(f"required variable {var} is not produced by ops/dev/gen_env.py")
    return problems


def main() -> int:
    sys.path.insert(0, str(ROOT / "ops" / "dev"))
    from gen_env import SECRETS  # noqa: PLC0415

    problems = check(yaml.safe_load(COMPOSE.read_text(encoding="utf-8")), set(SECRETS))
    for p in problems:
        print(f"compose check: {p}")
    print(f"compose check: {len(problems)} problem(s)")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())

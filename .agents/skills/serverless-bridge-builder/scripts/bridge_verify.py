"""
bridge_verify.py - CLI tool for validating serverless bridge projects.
Verifies zero-worker architectures, route security, and idempotency schemas.
"""

import argparse
import json
import os
import re
import sys
from pathlib import Path

def audit_project(root_dir: str, output_path: str | None = None) -> int:
    root = Path(root_dir).resolve()
    issues = []
    checks = []

    # 1. Check package.json dependencies
    pkg_file = root / "package.json"
    if pkg_file.exists():
        try:
            pkg = json.loads(pkg_file.read_text(encoding="utf-8"))
            deps = {**pkg.get("dependencies", {}), **pkg.get("devDependencies", {})}
            
            # Check for banned heavyweight worker/bot libraries
            if "discord.js" in deps:
                issues.append("BANNED DEPENDENCY: discord.js found. Bridge must use plain fetch REST v10.")
            else:
                checks.append("OK: No discord.js found (uses plain fetch).")

            # Check for Next.js 15+
            next_ver = deps.get("next", "")
            if next_ver:
                checks.append(f"OK: Next.js detected ({next_ver}).")
            else:
                issues.append("MISSING: Next.js not listed in dependencies.")
        except Exception as e:
            issues.append(f"Failed to read package.json: {e}")
    else:
        issues.append("Missing package.json in target directory.")

    # 2. Check inbound route security
    app_dir = root / "app" / "api"
    if app_dir.exists():
        route_files = list(app_dir.rglob("route.ts")) + list(app_dir.rglob("route.js"))
        for rf in route_files:
            content = rf.read_text(encoding="utf-8")
            rel_path = rf.relative_to(root)
            
            # Check for maxDuration setting
            if "maxDuration" in content:
                checks.append(f"OK: maxDuration configured in {rel_path}.")
            
            # Check for signature / token verification before logic
            has_sig_check = (
                "verifyKey" in content or
                "verifyDiscordRequest" in content or
                "X-Goog-Channel-Token" in content or
                "x-goog-channel-token" in content or
                "DRIVE_WEBHOOK_TOKEN" in content or
                "CRON_SECRET" in content or
                "authorization" in content.lower()
            )
            if has_sig_check:
                checks.append(f"OK: Inbound authorization check detected in {rel_path}.")
            else:
                issues.append(f"SECURITY RISK: No recognizable signature or token check found in {rel_path}.")
    else:
        checks.append("Notice: No app/api/ directory found to audit.")

    # 3. Check for SQL idempotency constraint
    sql_files = list(root.rglob("*.sql"))
    has_compound_unique = False
    for sf in sql_files:
        content = sf.read_text(encoding="utf-8")
        if re.search(r"UNIQUE\s*\(\s*file_id\s*,\s*modified_time\s*,\s*direction\s*\)", content, re.IGNORECASE):
            has_compound_unique = True
            break
        elif re.search(r"UNIQUE\s*\([^)]*modified_time[^)]*\)", content, re.IGNORECASE):
            has_compound_unique = True
            break

    if has_compound_unique:
        checks.append("OK: Compound unique idempotency constraint verified in SQL migrations.")
    else:
        issues.append("IDEMPOTENCY RISK: No compound UNIQUE (entity_id, modified_time, direction) found in .sql files.")

    report = {
        "root": str(root),
        "status": "PASS" if not issues else "FAIL",
        "checks": checks,
        "issues": issues,
    }

    if output_path:
        Path(output_path).write_text(json.dumps(report, indent=2), encoding="utf-8")
        print(f"Audit report saved to: {output_path}")
    else:
        print("\n=== BRIDGE ARCHITECTURE AUDIT ===")
        for c in checks:
            print(f"  [✓] {c}")
        for i in issues:
            print(f"  [!] {i}")
        print(f"Result: {report['status']}\n")

    return 0 if not issues else 1

def main():
    parser = argparse.ArgumentParser(description="Bridge Verification CLI")
    subparsers = parser.add_subparsers(dest="command", required=True)

    audit_parser = subparsers.add_parser("audit", help="Audit project for bridge best practices")
    audit_parser.add_argument("--dir", default=".", help="Project root directory")
    audit_parser.add_argument("--output", help="Optional path to write JSON report")

    args = parser.parse_args()

    if args.command == "audit":
        sys.exit(audit_project(args.dir, args.output))

if __name__ == "__main__":
    main()

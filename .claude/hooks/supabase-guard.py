#!/usr/bin/env python3
"""Ask before Supabase SQL or migrations that destroy data.

Supabase tools are pre-approved in .claude/settings.json. This hook runs before
execute_sql / apply_migration and forces a confirmation prompt when the SQL
drops, truncates or deletes anything. Everything else runs without asking.
"""
import json
import re
import sys

DESTRUCTIVE = re.compile(
    r"\b(drop|truncate)\b"          # DROP TABLE/COLUMN/SCHEMA/..., TRUNCATE
    r"|\bdelete\s+from\b"           # DELETE FROM
    r"|\bdelete\s+\w",              # DELETE tbl (shorthand)
    re.IGNORECASE,
)


def strip_comments(sql: str) -> str:
    sql = re.sub(r"/\*.*?\*/", " ", sql, flags=re.DOTALL)
    return re.sub(r"--[^\n]*", " ", sql)


def main() -> None:
    try:
        payload = json.load(sys.stdin)
    except Exception:
        return
    tool_input = payload.get("tool_input") or {}
    sql = " ".join(str(tool_input.get(k, "")) for k in ("query", "sql", "statement"))
    match = DESTRUCTIVE.search(strip_comments(sql))
    if not match:
        return
    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "ask",
            "permissionDecisionReason": (
                f"Supabase SQL contains '{match.group(0).strip().upper()}', "
                "which can permanently remove data. Confirm before running."
            ),
        }
    }))


if __name__ == "__main__":
    main()

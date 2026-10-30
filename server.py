"""Local funnel server.

Serves the app, stores one shared USER.md plus a MEMORY.md per project
(Hermes entry format), and calls an OpenAI-compatible API with a key that
stays in memory/settings.json.
"""

from __future__ import annotations

import json
import os
import re
import ssl
import threading
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
APP = ROOT / "app"
MEMORY_ROOT = ROOT / "memory"
PROJECTS = MEMORY_ROOT / "projects"
SETTINGS_PATH = MEMORY_ROOT / "settings.json"
INDEX_PATH = MEMORY_ROOT / "projects.json"
USER_PATH = MEMORY_ROOT / "USER.md"

DELIM = "\n§\n"
USER_LIMIT = 1375
MEMORY_LIMIT = 2200
ENTRY_CAP = 600

STAGES = {"cold", "email", "call", "prospect", "next", "offer", "close", "sale", "retain", "revenue"}
LOCK = threading.Lock()

BLOCKED = (
    "ignore previous",
    "ignore all instructions",
    "system prompt",
    "api key",
    "api_key",
    "bearer ",
    "sk-",
)


def read_json(path: Path, fallback):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return fallback


def write_json(path: Path, payload) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    temp.replace(path)


def blank_state():
    return {
        "companyName": "",
        "goal": "",
        "description": "",
        "context": "",
        "industry": "",
        "employees": "",
        "revenue": "",
        "status": "",
        "selected": "cold",
        "offer": {"outcome": "", "price": "", "guarantee": "", "sentence": ""},
        "math": {"cash30": "", "cost30": "", "spend": "", "customers": ""},
        "deals": [],
    }


def slug(name: str, taken: set[str]) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:32] or "project"
    candidate = base
    number = 2
    while candidate in taken:
        candidate = f"{base}-{number}"
        number += 1
    return candidate


def valid_id(project_id: str) -> bool:
    return bool(re.fullmatch(r"[a-z0-9][a-z0-9-]{0,40}", project_id or ""))


def load_index() -> dict:
    data = read_json(INDEX_PATH, None)
    if not data or not data.get("projects"):
        project_id = "first-project"
        data = {"active": project_id, "projects": [{"id": project_id, "name": "First project"}]}
        write_json(INDEX_PATH, data)
    USER_PATH.parent.mkdir(parents=True, exist_ok=True)
    if not USER_PATH.exists():
        USER_PATH.write_text("", encoding="utf-8")
    known = []
    for item in data["projects"]:
        if not valid_id(str(item.get("id") or "")):
            continue
        known.append({"id": item["id"], "name": str(item.get("name") or "Project")[:60]})
        project_dir(item["id"]).mkdir(parents=True, exist_ok=True)
        if not memory_path(item["id"]).exists():
            memory_path(item["id"]).write_text("", encoding="utf-8")
        if not state_path(item["id"]).exists():
            write_json(state_path(item["id"]), blank_state())
    if not known:
        known = [{"id": "first-project", "name": "First project"}]
    data["projects"] = known
    if not any(item["id"] == data.get("active") for item in known):
        data["active"] = known[0]["id"]
        save_index(data)
    return data


def save_index(data: dict) -> None:
    write_json(INDEX_PATH, data)


def project_dir(project_id: str) -> Path:
    return PROJECTS / project_id


def memory_path(project_id: str) -> Path:
    return project_dir(project_id) / "MEMORY.md"


def state_path(project_id: str) -> Path:
    return project_dir(project_id) / "state.json"


def load_settings() -> dict:
    data = read_json(SETTINGS_PATH, {})
    settings = {
        "apiKey": str(data.get("apiKey") or ""),
        "baseUrl": str(data.get("baseUrl") or "https://api.openai.com/v1").rstrip("/"),
        "model": str(data.get("model") or "gpt-4o-mini"),
    }
    # Dokploy env wins over the file so a redeploy can rotate the key
    # without baking it into the image.
    if os.environ.get("AI_API_KEY"):
        settings["apiKey"] = os.environ["AI_API_KEY"].strip()
    if os.environ.get("AI_BASE_URL"):
        settings["baseUrl"] = os.environ["AI_BASE_URL"].strip().rstrip("/")
    if os.environ.get("AI_MODEL"):
        settings["model"] = os.environ["AI_MODEL"].strip()[:80]
    return settings


def public_settings(settings: dict) -> dict:
    key = settings["apiKey"]
    return {
        "hasKey": bool(key),
        "keyHint": f"••••{key[-4:]}" if len(key) >= 4 else "",
        "baseUrl": settings["baseUrl"],
        "model": settings["model"],
    }


def parse_entries(text: str) -> list[str]:
    raw = (text or "").strip()
    if not raw:
        return []
    seen = set()
    entries = []
    for part in raw.split(DELIM):
        entry = part.strip()
        if entry and entry not in seen:
            seen.add(entry)
            entries.append(entry)
    return entries


def read_entries(path: Path) -> list[str]:
    try:
        return parse_entries(path.read_text(encoding="utf-8"))
    except OSError:
        return []


def write_entries(path: Path, entries: list[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    body = DELIM.join(entries)
    if body:
        body += "\n"
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_text(body, encoding="utf-8")
    temp.replace(path)


def char_count(entries: list[str]) -> int:
    if not entries:
        return 0
    return len(DELIM.join(entries))


def usage(entries: list[str], limit: int) -> dict:
    count = char_count(entries)
    pct = min(100, int((count / limit) * 100)) if limit else 0
    label = f"{pct}% — {count:,}/{limit:,} chars"
    return {"entries": entries, "count": count, "limit": limit, "pct": label, "usage": f"{count:,}/{limit:,}"}


def scan(content: str) -> str | None:
    lowered = content.lower()
    for pattern in BLOCKED:
        if pattern in lowered:
            return "That note looks like an instruction or a secret. It was not saved."
    if "\n§\n" in content:
        return "Notes cannot contain the memory separator."
    return None


def find_entry(entries: list[str], old_text: str):
    exact = [index for index, entry in enumerate(entries) if entry == old_text]
    matches = exact or [index for index, entry in enumerate(entries) if old_text in entry]
    unique = {entries[index] for index in matches}
    if len(unique) > 1:
        return None, True
    if not matches:
        return None, False
    return matches[0], False


def apply_op(target: str, action: str, content: str = "", old_text: str = "") -> dict:
    index = load_index()
    if target == "user":
        path, limit = USER_PATH, USER_LIMIT
    elif target == "memory":
        path, limit = memory_path(index["active"]), MEMORY_LIMIT
    else:
        return {"success": False, "error": "Target must be user or memory."}

    with LOCK:
        entries = read_entries(path)
        content = (content or "").strip()
        old_text = (old_text or "").strip()
        if action == "add":
            if not content:
                return {"success": False, "error": "Content cannot be empty."}
            if len(content) > ENTRY_CAP:
                return {"success": False, "error": f"Shorten the note to {ENTRY_CAP} characters."}
            blocked = scan(content)
            if blocked:
                return {"success": False, "error": blocked}
            if content in entries:
                result = {"success": True, "message": "Entry already exists (no duplicate added)."}
            elif char_count(entries + [content]) > limit:
                result = {
                    "success": False,
                    "error": f"Memory at {char_count(entries):,}/{limit:,} chars. Adding this entry ({len(content)} chars) would exceed the limit. Replace or remove an older note, then retry.",
                    "current_entries": entries,
                    "usage": f"{char_count(entries):,}/{limit:,}",
                }
            else:
                entries.append(content)
                write_entries(path, entries)
                result = {"success": True, "message": "Entry added."}
        elif action in ("replace", "remove"):
            if not old_text:
                return {"success": False, "error": "old_text cannot be empty."}
            found, ambiguous = find_entry(entries, old_text)
            if ambiguous:
                return {"success": False, "error": f"Multiple notes matched '{old_text}'. Be more specific.", "current_entries": entries}
            if found is None:
                return {"success": False, "error": f"No note matched '{old_text}'.", "current_entries": entries}
            if action == "remove":
                del entries[found]
                write_entries(path, entries)
                result = {"success": True, "message": "Entry removed."}
            else:
                if not content:
                    return {"success": False, "error": "new content cannot be empty."}
                if len(content) > ENTRY_CAP:
                    return {"success": False, "error": f"Shorten the note to {ENTRY_CAP} characters."}
                blocked = scan(content)
                if blocked:
                    return {"success": False, "error": blocked}
                updated = entries[:found] + [content] + entries[found + 1 :]
                if char_count(updated) > limit:
                    return {
                        "success": False,
                        "error": f"Replacement would exceed {limit:,} chars. Shorten it.",
                        "current_entries": entries,
                    }
                write_entries(path, updated)
                entries = updated
                result = {"success": True, "message": "Entry replaced."}
        else:
            return {"success": False, "error": "Action must be add, replace, or remove."}
        result["store"] = usage(entries, limit)
        return result


def memory_snapshot(target: str) -> dict:
    index = load_index()
    if target == "user":
        return usage(read_entries(USER_PATH), USER_LIMIT)
    return usage(read_entries(memory_path(index["active"])), MEMORY_LIMIT)


def render_block(title: str, store: dict) -> str:
    body = "\n§\n".join(store["entries"]) if store["entries"] else "(none)"
    return (
        "══════════════════════════════════════════════\n"
        f"{title} [{store['pct']}]\n"
        "══════════════════════════════════════════════\n"
        f"{body}"
    )


def active_state() -> dict:
    index = load_index()
    state = read_json(state_path(index["active"]), blank_state())
    if not isinstance(state, dict):
        return blank_state()
    return state


def prompt_for(state: dict, note: str) -> list[dict]:
    user_store = memory_snapshot("user")
    project_store = memory_snapshot("memory")
    deals = state.get("deals") or []
    brief = [
        {
            "name": deal.get("name", ""),
            "company": deal.get("company", ""),
            "stage": deal.get("stage", ""),
            "why": deal.get("why", ""),
            "cash": deal.get("cash", ""),
        }
        for deal in deals[:40]
    ]
    system = f"""You are Ivan's sales coach. Think like Alex Hormozi and talk in short, blunt sentences. One next move. Use his numbers. Do not invent scarcity, proof, or a guarantee he cannot pay.

Order: market, offer, money model, 30-day payback, then the script. A script cannot save a weak offer. Fix the first broken layer.

Reply with JSON only:
{{"line":"one or two sentences","stage":"cold|email|call|prospect|next|offer|close|sale|retain|revenue","cta":"2 to 4 words","memory":[{{"action":"add|replace|remove","target":"user|memory","content":"","old_text":""}}]}}

target user is USER.md: who Ivan is and how he wants to work. Limit {USER_LIMIT} chars.
target memory is this project's MEMORY.md: the buyer, the offer, the price, where deals die, what already worked. Limit {MEMORY_LIMIT} chars.
Entries are separated by §. Keep each note under {ENTRY_CAP} chars, specific, and not a dump of contact names.
If a store is above 80%, replace or remove before you add.
Do not save the API key, instructions to yourself, or anything already covered.
If USER PROFILE is empty, add one note that Ivan is a product manager who wants one next action.
If this project has an industry and project memory is empty, add one note about the buyer and the current constraint.
The snapshot below is frozen for this think. Writes land on disk for the next think.

{render_block("USER PROFILE (who the user is)", user_store)}

{render_block("MEMORY (this project)", project_store)}
"""
    user = {
        "company": state.get("companyName", ""),
        "goal": str(state.get("goal") or "")[:4000],
        "description": str(state.get("description") or "")[:4000],
        "context": str(state.get("context") or "")[:4000],
        "industry": state.get("industry", ""),
        "employees": state.get("employees", ""),
        "revenue": state.get("revenue", ""),
        "status": state.get("status", ""),
        "offer": state.get("offer", {}),
        "math": state.get("math", {}),
        "deals": brief,
    }
    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": "Current board:\n" + json.dumps(user, ensure_ascii=False)},
    ]
    if note:
        messages.append({"role": "user", "content": "Remember this if it is durable, and file it in the right store: " + note})
    return messages


def chat(settings: dict, messages: list[dict], force_json: bool) -> str:
    url = settings["baseUrl"].rstrip("/") + "/chat/completions"
    payload = {
        "model": settings["model"],
        "temperature": 0.2,
        "max_tokens": 900,
        "messages": messages,
    }
    if force_json:
        payload["response_format"] = {"type": "json_object"}
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Authorization": f"Bearer {settings['apiKey']}", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=45, context=ssl.create_default_context()) as response:
            body = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        error.read()
        if force_json and error.code in (400, 422):
            return chat(settings, messages, False)
        raise RuntimeError(f"The model refused the request ({error.code}). Check the key, base URL, and model.") from error
    except urllib.error.URLError as error:
        raise RuntimeError(f"Could not reach the model. {error.reason}") from error
    try:
        return body["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError) as error:
        raise RuntimeError("The model returned an unexpected response.") from error


def parse_model_json(text: str) -> dict:
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?", "", cleaned).strip()
        cleaned = re.sub(r"```$", "", cleaned).strip()
    data = json.loads(cleaned)
    if not isinstance(data, dict):
        raise ValueError("Expected an object.")
    return data


def normalize_reply(data: dict) -> dict:
    stage = data.get("stage") if data.get("stage") in STAGES else "cold"
    line = str(data.get("line") or "").strip()[:500]
    cta = str(data.get("cta") or "Do this").strip()[:48]
    ops = data.get("memory") if isinstance(data.get("memory"), list) else []
    clean_ops = []
    for op in ops[:8]:
        if not isinstance(op, dict):
            continue
        action = op.get("action")
        target = op.get("target")
        if action not in ("add", "replace", "remove") or target not in ("user", "memory"):
            continue
        clean_ops.append({
            "action": action,
            "target": target,
            "content": str(op.get("content") or ""),
            "old_text": str(op.get("old_text") or ""),
        })
    return {"line": line, "stage": stage, "cta": cta, "memory": clean_ops}


def run_ops(ops: list[dict]) -> tuple[list[str], list[str]]:
    learned = []
    errors = []
    for op in ops:
        result = apply_op(op["target"], op["action"], op.get("content", ""), op.get("old_text", ""))
        label = "user" if op["target"] == "user" else "project"
        if result.get("success") and "already exists" not in result.get("message", ""):
            learned.append(f"{label}: {result['message']}")
        elif not result.get("success"):
            errors.append(result.get("error") or "Could not update memory.")
    return learned, errors


def think(note: str) -> dict:
    settings = load_settings()
    if not settings["apiKey"]:
        raise RuntimeError("Set an AI key first.")
    if not allowed_base(settings["baseUrl"]):
        raise RuntimeError("Base URL must be https, or localhost http.")
    messages = prompt_for(active_state(), note.strip())
    try:
        reply = normalize_reply(parse_model_json(chat(settings, messages, True)))
    except (json.JSONDecodeError, ValueError) as error:
        raise RuntimeError("The model did not return a usable next move.") from error
    learned, errors = run_ops(reply["memory"])
    if errors:
        messages.append({"role": "assistant", "content": json.dumps(reply)})
        messages.append({
            "role": "user",
            "content": "Memory writes failed. Fix them in this turn with shorter replace or remove, then the add. "
            + " ".join(errors)
            + " Keep the same line, stage, and cta. JSON only.",
        })
        try:
            second = normalize_reply(parse_model_json(chat(settings, messages, True)))
            learned2, errors2 = run_ops(second["memory"])
            learned.extend(learned2)
            errors = errors2
            if second.get("line"):
                reply = second
        except (RuntimeError, ValueError, json.JSONDecodeError):
            pass
    return {
        "line": reply["line"],
        "stage": reply["stage"],
        "cta": reply["cta"],
        "learned": learned,
        "errors": errors,
        "user": memory_snapshot("user"),
        "memory": memory_snapshot("memory"),
    }


def bootstrap() -> dict:
    index = load_index()
    active = index["active"]
    return {
        "active": active,
        "projects": index["projects"],
        "state": read_json(state_path(active), blank_state()),
        "settings": public_settings(load_settings()),
        "user": memory_snapshot("user"),
        "memory": memory_snapshot("memory"),
        "paths": {
            "user": "memory/USER.md",
            "project": f"memory/projects/{active}/MEMORY.md",
        },
    }


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt: str, *args) -> None:
        print(f"[funnel] {self.address_string()} {fmt % args}")

    def send_json(self, payload, status: int = 200) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def read_body(self) -> dict:
        length = int(self.headers.get("Content-Length") or 0)
        if length > 1_000_000:
            raise ValueError("Request is too large.")
        if length == 0:
            return {}
        data = json.loads(self.rfile.read(length).decode("utf-8"))
        if not isinstance(data, dict):
            raise ValueError("Expected an object.")
        return data

    def do_GET(self) -> None:
        path = self.path.split("?", 1)[0]
        if path == "/api/health":
            self.send_json({"ok": True})
            return
        if path == "/api/bootstrap":
            self.send_json(bootstrap())
            return
        if path.startswith("/api/"):
            self.send_json({"error": "Not found."}, 404)
            return
        self.serve_static(path)

    def do_POST(self) -> None:
        path = self.path.split("?", 1)[0]
        try:
            body = self.read_body()
            if path == "/api/projects/create":
                self.send_json(create_project(str(body.get("name") or "New project")))
            elif path == "/api/projects/select":
                self.send_json(select_project(str(body.get("id") or "")))
            elif path == "/api/projects/rename":
                self.send_json(rename_project(str(body.get("id") or ""), str(body.get("name") or "")))
            elif path == "/api/projects/delete":
                self.send_json(delete_project(str(body.get("id") or "")))
            elif path == "/api/state":
                self.send_json(save_state(str(body.get("id") or ""), body.get("state")))
            elif path == "/api/settings":
                self.send_json(save_settings(body))
            elif path == "/api/memory":
                result = apply_op(str(body.get("target") or ""), str(body.get("action") or ""), str(body.get("content") or ""), str(body.get("old_text") or ""))
                status = 200 if result.get("success") else 400
                result["user"] = memory_snapshot("user")
                result["memory"] = memory_snapshot("memory")
                self.send_json(result, status)
            elif path == "/api/think":
                self.send_json(think(str(body.get("note") or "")))
            else:
                self.send_json({"error": "Not found."}, 404)
        except (ValueError, json.JSONDecodeError) as error:
            self.send_json({"error": str(error)}, 400)
        except RuntimeError as error:
            self.send_json({"error": str(error)}, 400)
        except Exception as error:  # noqa: BLE001 — surface a short message, keep the server up
            self.send_json({"error": f"Something broke while thinking. {error}"}, 500)

    def serve_static(self, path: str) -> None:
        relative = "index.html" if path in ("", "/") else path.lstrip("/")
        file_path = (APP / relative).resolve()
        if APP not in file_path.parents and file_path != APP:
            self.send_error(403)
            return
        if not file_path.is_file():
            self.send_error(404)
            return
        kind = {".html": "text/html", ".css": "text/css", ".js": "text/javascript"}.get(file_path.suffix, "application/octet-stream")
        data = file_path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", f"{kind}; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(data)


def create_project(name: str) -> dict:
    name = name.strip()[:60] or "New project"
    with LOCK:
        index = load_index()
        project_id = slug(name, {item["id"] for item in index["projects"]})
        index["projects"].append({"id": project_id, "name": name})
        index["active"] = project_id
        save_index(index)
        project_dir(project_id).mkdir(parents=True, exist_ok=True)
        write_entries(memory_path(project_id), [])
        write_json(state_path(project_id), blank_state())
    return bootstrap()


def select_project(project_id: str) -> dict:
    if not valid_id(project_id):
        raise ValueError("Unknown project.")
    with LOCK:
        index = load_index()
        if not any(item["id"] == project_id for item in index["projects"]):
            raise ValueError("Unknown project.")
        index["active"] = project_id
        save_index(index)
    return bootstrap()


def rename_project(project_id: str, name: str) -> dict:
    name = name.strip()[:60]
    if not name or not valid_id(project_id):
        raise ValueError("Give the project a name.")
    with LOCK:
        index = load_index()
        match = next((item for item in index["projects"] if item["id"] == project_id), None)
        if not match:
            raise ValueError("Unknown project.")
        match["name"] = name
        save_index(index)
    return bootstrap()


def delete_project(project_id: str) -> dict:
    if not valid_id(project_id):
        raise ValueError("Unknown project.")
    with LOCK:
        index = load_index()
        if len(index["projects"]) <= 1:
            raise ValueError("Keep at least one project. Clear the board instead.")
        if not any(item["id"] == project_id for item in index["projects"]):
            raise ValueError("Unknown project.")
        index["projects"] = [item for item in index["projects"] if item["id"] != project_id]
        if index["active"] == project_id:
            index["active"] = index["projects"][0]["id"]
        save_index(index)
        folder = project_dir(project_id)
        if folder.exists():
            for child in folder.iterdir():
                child.unlink()
            folder.rmdir()
    return bootstrap()


def save_state(project_id: str, state) -> dict:
    if not isinstance(state, dict) or not valid_id(project_id):
        raise ValueError("Missing project state.")
    index = load_index()
    if project_id != index["active"]:
        raise ValueError("That project is not open.")
    if not any(item["id"] == project_id for item in index["projects"]):
        raise ValueError("Unknown project.")
    write_json(state_path(project_id), state)
    return {"ok": True}


def save_settings(body: dict) -> dict:
    settings = load_settings()
    if body.get("clearKey"):
        settings["apiKey"] = ""
    elif str(body.get("apiKey") or "").strip():
        settings["apiKey"] = str(body["apiKey"]).strip()
    base = str(body.get("baseUrl") or settings["baseUrl"]).strip().rstrip("/")
    model = str(body.get("model") or settings["model"]).strip()[:80]
    if not allowed_base(base):
        raise ValueError("Base URL must be https, or localhost http.")
    if not model:
        raise ValueError("Set a model name.")
    settings["baseUrl"] = base
    settings["model"] = model
    write_json(SETTINGS_PATH, settings)
    return public_settings(settings)


def allowed_base(base: str) -> bool:
    return base.startswith("https://") or base.startswith("http://127.0.0.1") or base.startswith("http://localhost")


def main() -> None:
    host = os.environ.get("HOST", "0.0.0.0")
    port = int(os.environ.get("PORT", "8765"))
    load_index()
    server = ThreadingHTTPServer((host, port), Handler)
    print(f"Funnel is listening on {host}:{port}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()

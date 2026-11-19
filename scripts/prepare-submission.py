"""Create the two DAKER attachments from the built, link-checked project snapshot."""

import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import posixpath
import re
import stat
import tempfile
import zipfile


ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / "output"
DESTINATION = OUTPUT / "submission-2026-11-19"
SNAPSHOT = OUTPUT / "jeju-care-compass-mvp.zip"
PROPOSAL = "docs/submission-proposal.pdf"
PDF_NAME = "01-혼디-AI-Agent-기획서.pdf"
ZIP_NAME = "02-혼디-최종-결과물.zip"
SOURCE_DIRS = {"app", "web", "agent", "prompts", "scripts", "tests", "infra", ".github", "dist"}
SOURCE_FILES = {"package.json", "package-lock.json", ".env.example", "THIRD_PARTY.md", "DESIGN.md"}
DATA_FILES = {
    "research/datahub_catalog_screening_2026-10-31.csv",
    "research/health_catalog_screening_2026-10-31.csv",
    "research/center_schema_index_2026-10-31.csv",
    "research/datahub_audit_coverage_2026-10-31.json",
    "research/healthcare_hackathon_winners_2026-10-31.csv",
}
EVIDENCE = {
    "vehicle-recovery-qa/calendar-regression.json": "calendar.json",
    "coordination-qa/report.json": "coordination.json",
    "reservation-edit-qa/report.json": "reservation-edit.json",
    "vehicle-recovery-qa/01-handoff.md": "01-handoff.md",
    "vehicle-recovery-qa/02-recovered.md": "02-recovered.md",
}
SECRETS = re.compile(
    rb"\b(?:AKIA|ASIA)[A-Z0-9]{16}\b|sk-proj-[A-Za-z0-9_-]{20,}|"
    rb"sk-[A-Za-z0-9]{32,}|AIza[0-9A-Za-z_-]{30,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"
)


def judge_entry(path):
    """Choose submitted material and give judges one entry-point README."""
    parts = path.parts
    name = path.as_posix()
    if name == "docs/evaluator-readme.md":
        return "README.md"
    if name == "docs/third-party-notices.txt":
        return "THIRD_PARTY_LICENSES.txt"
    if name == "docs/public-evaluation-check.json":
        return "verification/public-agent.json"
    if parts[0] in SOURCE_DIRS or name in SOURCE_FILES or name in DATA_FILES:
        return name
    if parts[0] == "research" and path.suffix == ".md":
        return name
    if parts[0] == "orchestration" and (path.suffix == ".mjs" or path.name in {"rules.json", "README.md"}):
        return name
    if parts[0] == "docs" and len(parts) >= 2:
        if parts[1:3] == ("reviews", "2026-11-19-submission"):
            return name
        if len(parts) == 2 and path.suffix in {".md", ".pdf", ".html"}:
            # Development checklists and internal assessments concern earlier submissions.
            if path.stem not in {"award-strategy", "judging-agents", "next-steps", "refactoring-audit",
                                 "submission-cleanup-contract"}:
                return name
    return None


def documentation_links(name, data, destinations):
    """Keep historical references readable when their development artifacts are omitted."""
    def resolve_link(match):
        label, target = match.groups()
        if target.startswith(("#", "http:", "https:", "mailto:")):
            return match[0]
        dest = posixpath.normpath(posixpath.join(posixpath.dirname(name), target.split("#")[0]))
        if dest in destinations:
            return match[0]
        if name == "README.md":
            raise ValueError(f"심사 안내의 링크가 누락되었습니다. {target}")
        return label
    return re.sub(r"\[([^\]\n]+)\]\(([^()\s]+)\)", resolve_link, data.decode("utf-8")).encode("utf-8")


def read_local(relative):
    path = ROOT
    for part in relative.parts:
        path /= part
        info = path.lstat()
        if stat.S_ISLNK(info.st_mode) or getattr(info, "st_reparse_tag", 0):
            raise ValueError(f"링크는 포함할 수 없습니다. {relative}")
    return path.read_bytes()


def verify_member(name, data):
    parts = PurePosixPath(name).parts
    if (not parts or ".." in parts or "\\" in name or ":" in name or name.startswith("/")
            or {".git", ".runtime", ".next", "node_modules"}.intersection(parts)
            or any(p.startswith(".env") and name != ".env.example" for p in parts)):
        raise ValueError(f"제출할 수 없는 경로입니다. {name}")
    if name == ".env.example" and not re.search(rb"(?m)^OPENAI_API_KEY=\r?$", data):
        raise ValueError("환경 예시의 API 키는 비어 있어야 합니다.")
    if SECRETS.search(data):
        raise ValueError(f"비밀값 형태가 발견되었습니다. {name}")
    if b"\x00" not in data[:8192]:
        text = data.decode("utf-8", errors="replace")
        home = str(Path.home()).replace("\\", "/").casefold().rstrip("/") + "/"
        if home in text.replace("\\", "/").casefold():
            raise ValueError(f"사용자 로컬 경로가 발견되었습니다. {name}")


def verify_browser_report(filename, data, source_hash):
    report = json.loads(data)
    if report["sourceHash"] != source_hash:
        raise ValueError(f"증거의 실행 소스가 다릅니다. {filename}")
    if filename == "calendar.json":
        passed = bool(report["measurements"]) and not report["posts"]
    else:
        checks = report["checks"]
        posts = report["apiPosts"] if filename == "coordination.json" else report["posts"]
        passed = (bool(checks) and report["passed"] == len(checks) and not report["failed"]
                  and all(check["pass"] is True for check in checks) and posts == 0)
    if not passed or report["errors"]:
        raise ValueError(f"브라우저 검사를 통과하지 못했습니다. {filename}")


def prepare():
    DESTINATION.mkdir(parents=True, exist_ok=True)
    with (tempfile.TemporaryDirectory(dir=DESTINATION) as staging,
          zipfile.ZipFile(SNAPSHOT) as snapshot):
        staging = Path(staging)
        archive_path = staging / ZIP_NAME
        written = set()
        prefix = "jeju-care-compass-mvp/"
        entries = []
        for entry in snapshot.infolist():
            if entry.is_dir() or not entry.filename.startswith(prefix):
                raise ValueError(f"잘못된 스냅샷 항목입니다. {entry.filename}")
            name = judge_entry(PurePosixPath(entry.filename[len(prefix):]))
            if name:
                entries.append((entry, name))
        destinations = {name for entry, name in entries}
        destinations.update({"README.md", "THIRD_PARTY_LICENSES.txt", "verification/public-agent.json"})
        destinations.update("verification/" + name for name in EVIDENCE.values())
        destinations.update({str(parent) for name in destinations for parent in PurePosixPath(name).parents})

        with zipfile.ZipFile(archive_path, "w", compression=zipfile.ZIP_DEFLATED) as release:
            def add(name, data):
                if name in written:
                    raise ValueError(f"중복 경로입니다. {name}")
                if name == "README.md" or (name.endswith(".md") and
                        (name.startswith(("docs/", "research/", "orchestration/")) or name in SOURCE_FILES)):
                    data = documentation_links(name, data, destinations)
                verify_member(name, data)
                release.writestr("hondi/" + name, data)
                written.add(name)

            for entry, name in entries:
                add(name, snapshot.read(entry))

            for name in ("README.md", "THIRD_PARTY_LICENSES.txt"):
                if name not in written:
                    add(name, read_local(Path(name)))
            if "verification/public-agent.json" not in written:
                add("verification/public-agent.json", read_local(Path("verification/public-agent.json")))

            deployment = json.loads(snapshot.read(prefix + "dist/deployment.json"))
            for origin, filename in EVIDENCE.items():
                relative = Path("output") / origin
                if not (ROOT / relative).exists():
                    relative = Path("verification") / filename
                data = read_local(relative)
                if filename.endswith(".json"):
                    verify_browser_report(filename, data, deployment["sourceHash"])
                add("verification/" + filename, data)

            required = {PROPOSAL, "docs/submission-proposal.html", ".env.example", "README.md",
                        "THIRD_PARTY_LICENSES.txt", "package-lock.json", "dist/index.html",
                        "app/data/hospital-candidates.json", "app/data/visit-support-providers.json",
                        "app/data/public-health-contacts.json"}
            if missing := required - written:
                raise ValueError(f"필수 파일 누락: {sorted(missing)}")

        with zipfile.ZipFile(archive_path) as release:
            if bad := release.testzip():
                raise ValueError(f"ZIP 검사 실패: {bad}")
            (staging / PDF_NAME).write_bytes(release.read("hondi/" + PROPOSAL))
        for filename in (ZIP_NAME, PDF_NAME):
            target = DESTINATION / filename
            os.replace(staging / filename, target)
            with target.open("rb") as stream:
                digest = hashlib.sha256()
                for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                    digest.update(chunk)
            print(f"{filename}  {target.stat().st_size:,} bytes  SHA256 {digest.hexdigest()}")


if __name__ == "__main__":
    prepare()

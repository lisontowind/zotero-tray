"""Deterministic, dependency-free XPI builder. Python 3.9+."""
import hashlib
import json
import argparse
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parents[1]


def build():
    addon = ROOT / "addon"
    manifest = json.loads((addon / "manifest.json").read_text(encoding="utf-8"))
    files = sorted(p for p in addon.rglob("*") if p.is_file())
    allowed = {".js", ".json", ".svg", ".png", ".ico", ".ftl"}
    for path in files:
        if path.suffix.lower() not in allowed:
            raise ValueError(f"Unexpected package file: {path}")
    output = ROOT / "dist" / f"zotero-tray-{manifest['version']}.xpi"
    output.parent.mkdir(exist_ok=True)
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for path in files:
            info = zipfile.ZipInfo(path.relative_to(addon).as_posix(), (2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            archive.writestr(info, path.read_bytes())
        info = zipfile.ZipInfo("LICENSE", (2026, 1, 1, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        info.external_attr = 0o100644 << 16
        archive.writestr(info, (ROOT / "LICENSE").read_bytes())
    digest = hashlib.sha256(output.read_bytes()).hexdigest()
    output.with_suffix(".xpi.sha256").write_bytes(f"{digest}  {output.name}\n".encode("ascii"))
    compatibility = manifest["applications"]["zotero"]
    repository = manifest["homepage_url"].rstrip("/")
    updates = {"addons": {compatibility["id"]: {"updates": [{
        "version": manifest["version"],
        "update_link": f"{repository}/releases/download/v{manifest['version']}/{output.name}",
        "update_hash": f"sha256:{digest}",
        "applications": {"zotero": {
            key: compatibility[key] for key in ("strict_min_version", "strict_max_version")
        }},
    }]}}}
    (output.parent / "updates.json").write_bytes(
        (json.dumps(updates, indent=2) + "\n").encode("utf-8"))
    print(f"Built {output}\nSHA-256 {digest}")
    return output


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tag", help="Require a release tag matching the manifest version")
    args = parser.parse_args()
    if args.tag:
        version = json.loads((ROOT / "addon" / "manifest.json").read_text(encoding="utf-8"))["version"]
        if args.tag != f"v{version}":
            parser.error(f"Release tag must be v{version}, got {args.tag}")
    build()

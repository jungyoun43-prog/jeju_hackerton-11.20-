#!/usr/bin/env python3
"""공식 Pretendard 1.3.9 로컬 아카이브에서 검증한 분할 자산만 복사한다."""

import argparse
import hashlib
import json
from pathlib import Path
import re
import sys
import tarfile

ROOT = Path(__file__).resolve().parent.parent
PACKAGE_SHA256 = "0ffc240cee83be02520fb4ac1b2a0a51052b9d13506ade0ba90c591dbbb3bd53"
CSS_SHA256 = "2973bcae80262dcb630cfb793fbf6af29bd986c769ee54953fb3e5b3e32323ca"
FONTS_SHA256 = "21039a354646232cbc09c8177491579bbeb7aa888ec51c709abe749a1cdcd786"
LICENSE_SHA256 = "b04538c9abec39a3db75108cf0af0fd9c77032fe8aa2cf38345b4d250e98e38e"
SOURCE = "package/dist/web/variable/"
CSS_NAME = "pretendardvariable-dynamic-subset.css"
FONT_NAMES = [f"woff2-dynamic-subset/PretendardVariable.subset.{i}.woff2" for i in range(92)]
FAMILY_FROM, FAMILY_TO = b"font-family: 'Pretendard Variable'", b"font-family: 'Pretendard'"


def digest(data):
    return hashlib.sha256(data).hexdigest()


def prepare(archive_path, output):
    checksum = hashlib.sha256()
    with archive_path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            checksum.update(chunk)
    if checksum.hexdigest() != PACKAGE_SHA256:
        raise ValueError("공식 pretendard 1.3.9 패키지 해시가 아닙니다.")
    expected = {SOURCE + name for name in [CSS_NAME, *FONT_NAMES]} | {"package/package.json", "package/dist/LICENSE.txt"}
    with tarfile.open(archive_path, "r:gz") as archive:
        members = [member for member in archive.getmembers() if member.name in expected]
        if len(members) != len(expected) or {member.name for member in members} != expected or any(not member.isfile() for member in members):
            raise ValueError("공식 패키지의 필수 일반 파일 목록이 일치하지 않습니다.")
        originals = {member.name: archive.extractfile(member).read() for member in members}
    package = json.loads(originals["package/package.json"])
    if (package["name"], package["version"], package["license"]) != ("pretendard", "1.3.9", "OFL-1.1"):
        raise ValueError("패키지 이름·버전·라이선스가 일치하지 않습니다.")
    license_bytes = originals["package/dist/LICENSE.txt"]
    if digest(license_bytes) != LICENSE_SHA256 or (ROOT / "app/assets/Pretendard-LICENSE.txt").read_bytes() != license_bytes:
        raise ValueError("보존한 OFL 원문이 일치하지 않습니다.")
    css = originals[SOURCE + CSS_NAME]
    if digest(css) != CSS_SHA256 or css.count(b"@font-face") != 92 or css.count(FAMILY_FROM) != 92:
        raise ValueError("공식 CSS 원문·92개 font-face가 일치하지 않습니다.")
    urls = re.findall(rb"src: url\(\./([^)]*)\)", css)
    ranges = re.findall(rb"unicode-range: ([^;]+);", css)
    if urls != [name.encode() for name in FONT_NAMES] or len(ranges) != 92:
        raise ValueError("공식 글자 범위와 로컬 WOFF2 주소 목록이 일치하지 않습니다.")
    for block in ranges:
        for token in block.decode().split(","):
            match = re.fullmatch(r"U\+([0-9a-fA-F]+)(?:-([0-9a-fA-F]+))?", token.strip())
            if not match or not 0 <= int(match[1], 16) <= int(match[2] or match[1], 16) <= 0x10FFFF:
                raise ValueError("유효하지 않은 공식 Unicode 범위입니다.")
    assets = {name: originals[SOURCE + name] for name in FONT_NAMES}
    font_index = "".join(f"{name}\0{digest(data)}\n" for name, data in assets.items())
    if any(data[:4] != b"wOF2" for data in assets.values()) or digest(font_index.encode()) != FONTS_SHA256:
        raise ValueError("공식 92개 WOFF2 바이너리와 일치하지 않습니다.")
    alias_css = css.replace(FAMILY_FROM, FAMILY_TO)
    if alias_css.replace(FAMILY_TO, FAMILY_FROM) != css or re.findall(rb"unicode-range: ([^;]+);", alias_css) != ranges:
        raise ValueError("CSS 별칭 이외의 원문 변경은 허용하지 않습니다.")
    assets = {CSS_NAME: alias_css, **assets}
    manifest = {
        "schemaVersion": 1,
        "package": {"name": "pretendard", "version": "1.3.9", "url": "https://registry.npmjs.org/pretendard/-/pretendard-1.3.9.tgz", "sha256": PACKAGE_SHA256},
        "license": {"path": "../Pretendard-LICENSE.txt", "sourceMember": "package/dist/LICENSE.txt", "sha256": LICENSE_SHA256},
        "source": {"cssMember": SOURCE + CSS_NAME, "cssSha256": CSS_SHA256, "woff2Directory": SOURCE + "woff2-dynamic-subset/", "woff2Count": 92, "woff2SetSha256": FONTS_SHA256},
        "transformation": {"cssFamilyAlias": {"from": "Pretendard Variable", "to": "Pretendard"}, "fontBinaries": "unmodified", "unicodeRanges": "unmodified"},
        "reproduce": "python3 scripts/prepare-fonts.py /path/to/pretendard-1.3.9.tgz",
        "files": [{"path": name, "bytes": len(data), "sha256": digest(data)} for name, data in assets.items()],
    }
    assets["manifest.json"] = (json.dumps(manifest, ensure_ascii=False, indent=2) + "\n").encode()
    # 검사 실패 시 기존 자산을 덮지 않으며 출력 링크도 따라가지 않는다.
    for path in [output, *output.parents, *(output / name for name in assets), output / "woff2-dynamic-subset"]:
        if path.is_symlink():
            raise ValueError("폰트 출력의 심볼릭 링크는 허용하지 않습니다.")
    output.mkdir(parents=True, exist_ok=True)
    (output / "woff2-dynamic-subset").mkdir(exist_ok=True)
    for name, data in assets.items():
        (output / name).write_bytes(data)
    return manifest


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path, help="미리 받은 공식 pretendard-1.3.9.tgz 로컬 경로")
    parser.add_argument("--output", type=Path, default=ROOT / "app/assets/pretendard")
    args = parser.parse_args()
    try:
        result = prepare(args.archive, args.output.absolute())
    except (OSError, ValueError, tarfile.TarError) as error:
        sys.exit(f"폰트 준비 실패: {error}")
    print(f"공식 Pretendard {result['package']['version']} · CSS와 WOFF2 92개 검증·복사 완료")

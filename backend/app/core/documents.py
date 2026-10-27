"""Bounded local text extraction and chunking for student study materials."""

import re
import zipfile
from pathlib import Path
from xml.etree import ElementTree


def split_text(text: str, max_chars: int = 1_200, overlap: int = 180) -> list[str]:
    """Split at paragraph/sentence boundaries where possible, with a small overlap."""
    normalized = re.sub(r"\s+", " ", text).strip()
    if not normalized:
        return []
    chunks: list[str] = []
    start = 0
    while start < len(normalized):
        end = min(len(normalized), start + max_chars)
        if end < len(normalized):
            boundary = max(normalized.rfind(". ", start + max_chars // 2, end), normalized.rfind("; ", start + max_chars // 2, end))
            if boundary > start:
                end = boundary + 1
        chunk = normalized[start:end].strip()
        if chunk:
            chunks.append(chunk)
        if end >= len(normalized):
            break
        start = max(start + 1, end - overlap)
    return chunks


def extract_docx(path: Path, max_xml_bytes: int = 50_000_000) -> str:
    try:
        with zipfile.ZipFile(path) as archive:
            if "word/document.xml" not in archive.namelist():
                raise ValueError("This DOCX file is missing its document content.")
            info = archive.getinfo("word/document.xml")
            if info.file_size > max_xml_bytes:
                raise ValueError("This DOCX expands beyond the safe processing limit. Try a smaller document.")
            with archive.open(info) as xml_file:
                root = ElementTree.fromstring(xml_file.read(max_xml_bytes + 1))
        namespace = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
        paragraphs = []
        for paragraph in root.findall(".//w:p", namespace):
            value = "".join(node.text or "" for node in paragraph.findall(".//w:t", namespace)).strip()
            if value:
                paragraphs.append(value)
        return "\n\n".join(paragraphs)
    except (zipfile.BadZipFile, ElementTree.ParseError, KeyError) as error:
        raise ValueError("This DOCX file is corrupted or could not be read. Re-export it and try again.") from error


def extract_txt(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8-sig")
    except UnicodeDecodeError as error:
        raise ValueError("This TXT file is not valid UTF-8 text. Save it as UTF-8 and try again.") from error

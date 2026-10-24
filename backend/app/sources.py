"""Bounded source extraction with public-address-only webpage retrieval."""
from __future__ import annotations

import csv
import hashlib
import http.client
import ipaddress
import io
import socket
import ssl
import time
from email.message import Message
from html.parser import HTMLParser
from urllib.parse import urljoin, urlsplit, urlunsplit
from uuid import uuid4

from .schemas import SourceMetadata, SourceReference, SourceSnapshot

MAX_FILE_BYTES = 10 * 1024 * 1024
MAX_PDF_PAGES = 100
MAX_CSV_ROWS = 10_000
MAX_CSV_COLUMNS = 200
MAX_TEXT_CHARS = 100_000
MAX_REFERENCES = 5_000
MAX_WEB_BYTES = 5 * 1024 * 1024
WEB_TIMEOUT_SECONDS = 10
MAX_REDIRECTS = 3
UNBOUND_TTL_SECONDS = 30 * 60


class SourceFailure(Exception):
    def __init__(self, status: int, code: str, message: str):
        self.status = status
        self.code = code
        self.message = message
        super().__init__(code)


def _safe_name(name: str, fallback: str) -> str:
    value = name.replace('\\', '/').rsplit('/', 1)[-1]
    value = ''.join(ch for ch in value if ch.isprintable() and ch not in '<>"')[:200].strip()
    return value or fallback


def _snapshot(kind: str, name: str, media_type: str, extracted: str,
              references: list[SourceReference], started: float, *,
              unit_count: int | None = None, original_url: str | None = None,
              final_url: str | None = None, retrieved_at: str | None = None,
              references_complete: bool = True) -> SourceSnapshot:
    if len(extracted) > MAX_TEXT_CHARS:
        raise SourceFailure(413, 'SOURCE_TEXT_TOO_LARGE', 'Extracted source text exceeds the 100,000-character limit.')
    if not extracted.strip():
        raise SourceFailure(422, 'SOURCE_EMPTY', 'No readable text was found in this source.')
    expires = time.time() + UNBOUND_TTL_SECONDS
    expires_at = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(expires))
    metadata = SourceMetadata(source_id=uuid4(), kind=kind, name=_safe_name(name, kind.title()),
                              media_type=media_type, original_url=original_url, final_url=final_url,
                              retrieved_at=retrieved_at, content_sha256=hashlib.sha256(extracted.encode('utf-8')).hexdigest(),
                              character_count=len(extracted), unit_count=unit_count,
                              parse_duration_ms=(time.perf_counter() - started) * 1000,
                              expires_at=expires_at, references=references,
                              references_complete=references_complete)
    return SourceSnapshot(**metadata.model_dump(), extracted_text=extracted)


def parse_text(text: str, name: str = 'Pasted text') -> SourceSnapshot:
    started = time.perf_counter()
    if not text.strip():
        raise SourceFailure(400, 'SOURCE_INVALID', 'Enter nonempty source text.')
    return _snapshot('text', name, 'text/plain; charset=utf-8', text, [], started, unit_count=None)


def parse_pdf(data: bytes, name: str) -> SourceSnapshot:
    started = time.perf_counter()
    if len(data) > MAX_FILE_BYTES:
        raise SourceFailure(413, 'SOURCE_TOO_LARGE', 'PDF exceeds the 10 MiB file limit.')
    if not data.startswith(b'%PDF-'):
        raise SourceFailure(415, 'SOURCE_TYPE_UNSUPPORTED', 'The selected file is not a valid PDF.')
    try:
        from pypdf import PdfReader
        reader = PdfReader(io.BytesIO(data), strict=True)
        if reader.is_encrypted:
            raise SourceFailure(415, 'SOURCE_PDF_ENCRYPTED', 'Encrypted PDFs are not supported.')
        if len(reader.pages) > MAX_PDF_PAGES:
            raise SourceFailure(413, 'SOURCE_TOO_MANY_PAGES', 'PDF exceeds the 100-page limit.')
        parts: list[str] = []
        refs: list[SourceReference] = []
        text_pages = 0
        for index, page in enumerate(reader.pages, start=1):
            try:
                page_text = page.extract_text(extraction_mode='plain') or ''
            except Exception:
                raise SourceFailure(422, 'SOURCE_PARSE_FAILED', 'The PDF text could not be extracted safely.') from None
            page_text = page_text.strip()
            if not page_text:
                continue
            text_pages += 1
            prefix = f'[Page {index}]\n'
            start = sum(len(part) for part in parts) + len(prefix)
            parts.extend((prefix, page_text, '\n'))
            if len(refs) < MAX_REFERENCES:
                refs.append(SourceReference(kind='pdf_page', page_number=index, start_char=start,
                                            end_char=start + len(page_text), excerpt=page_text[:500]))
            if sum(len(part) for part in parts) > MAX_TEXT_CHARS:
                raise SourceFailure(413, 'SOURCE_TEXT_TOO_LARGE', 'Extracted PDF text exceeds the 100,000-character limit.')
        if not parts:
            raise SourceFailure(415, 'SOURCE_PDF_SCANNED', 'No selectable text was found. Scanned PDFs need OCR, which is not enabled.')
        text = ''.join(parts).rstrip()
        return _snapshot('pdf', name, 'application/pdf', text, refs, started,
                         unit_count=len(reader.pages), references_complete=len(refs) == text_pages)
    except SourceFailure:
        raise
    except Exception:
        raise SourceFailure(422, 'SOURCE_PARSE_FAILED', 'The PDF is malformed or could not be read.') from None


def _csv_cell(value: str) -> str:
    buffer = io.StringIO(newline='')
    csv.writer(buffer, lineterminator='').writerow([value])
    return buffer.getvalue()


def parse_csv(data: bytes, name: str) -> SourceSnapshot:
    started = time.perf_counter()
    if len(data) > MAX_FILE_BYTES:
        raise SourceFailure(413, 'SOURCE_TOO_LARGE', 'CSV exceeds the 10 MiB file limit.')
    try:
        text = data.decode('utf-8-sig', errors='strict')
    except UnicodeDecodeError:
        raise SourceFailure(415, 'SOURCE_CSV_ENCODING_UNSUPPORTED', 'CSV must use UTF-8 or UTF-8 with BOM.') from None
    try:
        csv.field_size_limit(MAX_FILE_BYTES)
        rows = list(csv.reader(io.StringIO(text, newline=''), strict=True))
    except (csv.Error, UnicodeError, OverflowError):
        raise SourceFailure(422, 'SOURCE_PARSE_FAILED', 'The CSV quoting or row structure is malformed.') from None
    if not rows:
        raise SourceFailure(422, 'SOURCE_EMPTY', 'The CSV contains no rows.')
    if any(len(row) > MAX_CSV_COLUMNS for row in rows):
        raise SourceFailure(413, 'SOURCE_TOO_MANY_COLUMNS', 'CSV exceeds the 200-column limit.')
    if len(rows) - 1 > MAX_CSV_ROWS:
        raise SourceFailure(413, 'SOURCE_TOO_MANY_ROWS', 'CSV exceeds the 10,000-data-row limit.')
    headers = rows[0]
    parts: list[str] = []
    refs: list[SourceReference] = []
    complete = True
    offset = 0
    for row_index, row in enumerate(rows):
        rendered = [_csv_cell(cell) for cell in row]
        line = ','.join(rendered)
        parts.append(line)
        if row_index > 0:
            cell_offset = offset
            for column_index, (cell, encoded) in enumerate(zip(row, rendered)):
                if cell and len(refs) < MAX_REFERENCES:
                    column = headers[column_index] if column_index < len(headers) else ''
                    refs.append(SourceReference(kind='csv_cell', row_number=row_index + 1,
                                                column_name=column or None, column_index=column_index + 1,
                                                start_char=cell_offset, end_char=cell_offset + len(encoded), excerpt=cell[:500]))
                elif cell:
                    complete = False
                cell_offset += len(encoded) + (1 if column_index + 1 < len(rendered) else 0)
        offset += len(line) + (1 if row_index + 1 < len(rows) else 0)
        if offset > MAX_TEXT_CHARS:
            raise SourceFailure(413, 'SOURCE_TEXT_TOO_LARGE', 'Extracted CSV text exceeds the 100,000-character limit.')
    extracted = '\n'.join(parts)
    return _snapshot('csv', name, 'text/csv; charset=utf-8', extracted, refs, started,
                     unit_count=max(0, len(rows) - 1), references_complete=complete)


class _VisibleText(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self._skip = 0

    def handle_starttag(self, tag, attrs):
        if tag.lower() in {'script', 'style', 'noscript', 'template', 'svg'}:
            self._skip += 1
        elif tag.lower() in {'p', 'div', 'br', 'li', 'tr', 'h1', 'h2', 'h3', 'section', 'article'} and self._skip == 0:
            self.parts.append('\n')

    def handle_endtag(self, tag):
        if tag.lower() in {'script', 'style', 'noscript', 'template', 'svg'} and self._skip:
            self._skip -= 1
        elif tag.lower() in {'p', 'div', 'li', 'tr', 'h1', 'h2', 'h3', 'section', 'article'} and self._skip == 0:
            self.parts.append('\n')

    def handle_data(self, data):
        if self._skip == 0:
            self.parts.append(data)


def _validate_public_url(value: str, resolver=socket.getaddrinfo):
    if any(ord(char) < 0x21 or ord(char) == 0x7f or char == '\\' for char in value):
        raise SourceFailure(400, 'SOURCE_URL_INVALID', 'Enter a valid public HTTP or HTTPS webpage URL.')
    try:
        parsed = urlsplit(value)
        host = parsed.hostname
        port = parsed.port or (443 if parsed.scheme.lower() == 'https' else 80)
    except ValueError:
        raise SourceFailure(400, 'SOURCE_URL_INVALID', 'Enter a valid public HTTP or HTTPS webpage URL.') from None
    expected_port = 443 if parsed.scheme.lower() == 'https' else 80
    if parsed.scheme.lower() not in {'http', 'https'} or not host or parsed.username or parsed.password or port != expected_port:
        raise SourceFailure(400, 'SOURCE_URL_INVALID', 'Only public HTTP or HTTPS URLs on ports 80 and 443 are supported.')
    try:
        host = host.rstrip('.').encode('idna').decode('ascii').lower()
    except UnicodeError:
        raise SourceFailure(400, 'SOURCE_URL_INVALID', 'Enter a valid public HTTP or HTTPS webpage URL.') from None
    try:
        literal = ipaddress.ip_address(host.strip('[]'))
        addresses = [str(literal)]
    except ValueError:
        try:
            answers = resolver(host, port, type=socket.SOCK_STREAM)
            addresses = list(dict.fromkeys(answer[4][0].split('%', 1)[0] for answer in answers))
        except OSError:
            raise SourceFailure(502, 'SOURCE_FETCH_FAILED', 'The public webpage host could not be resolved.') from None
    if not addresses:
        raise SourceFailure(502, 'SOURCE_FETCH_FAILED', 'The public webpage host returned no addresses.')
    try:
        if any(not ipaddress.ip_address(address).is_global for address in addresses):
            raise SourceFailure(502, 'SOURCE_DESTINATION_BLOCKED', 'The webpage resolves to a non-public network address.')
    except ValueError:
        raise SourceFailure(502, 'SOURCE_DESTINATION_BLOCKED', 'The webpage resolved to an invalid network address.') from None
    return parsed, host, port, addresses


class _PinnedHTTPConnection(http.client.HTTPConnection):
    def __init__(self, host, port, address, timeout):
        super().__init__(host, port, timeout=timeout)
        self.address = address

    def connect(self):
        self.sock = socket.create_connection((self.address, self.port), self.timeout)


class _PinnedHTTPSConnection(http.client.HTTPSConnection):
    def __init__(self, host, port, address, timeout):
        super().__init__(host, port, timeout=timeout, context=ssl.create_default_context())
        self.address = address

    def connect(self):
        raw = socket.create_connection((self.address, self.port), self.timeout)
        self.sock = self._context.wrap_socket(raw, server_hostname=self.host)


def fetch_webpage(url: str, *, resolver=socket.getaddrinfo, connection_factory=None) -> tuple[str, str, str, str, int]:
    """Fetch one public text page, pinning the socket to a checked public IP."""
    started = time.perf_counter()
    current = url
    for redirect_count in range(MAX_REDIRECTS + 1):
        if time.perf_counter() - started > WEB_TIMEOUT_SECONDS:
            raise SourceFailure(504, 'SOURCE_FETCH_TIMEOUT', 'Webpage retrieval exceeded its 10-second limit.')
        parsed, host, port, addresses = _validate_public_url(current, resolver)
        scheme = parsed.scheme.lower()
        path = urlunsplit(('', '', parsed.path or '/', parsed.query, ''))
        timeout = max(0.1, WEB_TIMEOUT_SECONDS - (time.perf_counter() - started))
        address = addresses[0]
        if connection_factory:
            connection = connection_factory(scheme, host, port, address, timeout)
        elif scheme == 'https':
            connection = _PinnedHTTPSConnection(host, port, address, timeout)
        else:
            connection = _PinnedHTTPConnection(host, port, address, timeout)
        try:
            connection.request('GET', path, headers={'Host': parsed.netloc, 'Accept': 'text/html,application/xhtml+xml,text/plain',
                                                     'Accept-Encoding': 'identity', 'Connection': 'close', 'User-Agent': 'EcoAgentSourceReader/1.0'})
            response = connection.getresponse()
            if response.status in {301, 302, 303, 307, 308}:
                location = response.getheader('Location')
                response.read(1024)
                if redirect_count >= MAX_REDIRECTS or not location:
                    raise SourceFailure(502, 'SOURCE_REDIRECT_BLOCKED', 'The webpage redirected too many times or returned an invalid redirect.')
                current = urljoin(current, location)
                continue
            if response.status != 200:
                raise SourceFailure(502, 'SOURCE_FETCH_FAILED', 'The webpage returned an unsuccessful response.')
            content_type = response.getheader('Content-Type', '').strip()
            message = Message(); message['content-type'] = content_type
            media_type = message.get_content_type().lower()
            if media_type not in {'text/html', 'application/xhtml+xml', 'text/plain'}:
                raise SourceFailure(422, 'SOURCE_URL_UNSUPPORTED_CONTENT', 'The webpage response is not HTML or plain text.')
            if response.getheader('Content-Encoding', 'identity').lower() not in {'', 'identity'}:
                raise SourceFailure(422, 'SOURCE_URL_UNSUPPORTED_CONTENT', 'Compressed webpage responses are not supported.')
            length = response.getheader('Content-Length')
            if length and length.isdigit() and int(length) > MAX_WEB_BYTES:
                raise SourceFailure(413, 'SOURCE_FETCH_TOO_LARGE', 'The webpage response exceeds the 5 MiB limit.')
            chunks = []
            received = 0
            while True:
                if time.perf_counter() - started > WEB_TIMEOUT_SECONDS:
                    raise SourceFailure(504, 'SOURCE_FETCH_TIMEOUT', 'Webpage retrieval exceeded its 10-second limit.')
                chunk = response.read(min(64 * 1024, MAX_WEB_BYTES + 1 - received))
                if not chunk:
                    break
                chunks.append(chunk); received += len(chunk)
                if received > MAX_WEB_BYTES:
                    raise SourceFailure(413, 'SOURCE_FETCH_TOO_LARGE', 'The webpage response exceeds the 5 MiB limit.')
            body = b''.join(chunks)
            charset = message.get_content_charset() or 'utf-8'
            try:
                raw_text = body.decode(charset, errors='strict')
            except (LookupError, UnicodeDecodeError):
                raise SourceFailure(422, 'SOURCE_URL_UNSUPPORTED_CONTENT', 'The webpage text encoding is unsupported or invalid.') from None
            if media_type == 'text/plain':
                extracted = raw_text
            else:
                parser = _VisibleText()
                parser.feed(raw_text); parser.close()
                extracted = '\n'.join(' '.join(line.split()) for line in ''.join(parser.parts).splitlines() if line.strip())
            # Query strings can contain access tokens. They are used for the request but
            # excluded from persisted/displayed provenance; fragments are never sent.
            final_url = urlunsplit((scheme, parsed.netloc, parsed.path or '/', '', ''))
            retrieved_at = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
            return extracted, final_url, media_type, retrieved_at, int((time.perf_counter() - started) * 1000)
        except SourceFailure:
            raise
        except (OSError, TimeoutError, http.client.HTTPException, ssl.SSLError):
            if time.perf_counter() - started >= WEB_TIMEOUT_SECONDS:
                raise SourceFailure(504, 'SOURCE_FETCH_TIMEOUT', 'Webpage retrieval exceeded its 10-second limit.') from None
            raise SourceFailure(502, 'SOURCE_FETCH_FAILED', 'The webpage could not be retrieved safely.') from None
        finally:
            connection.close()
    raise SourceFailure(502, 'SOURCE_REDIRECT_BLOCKED', 'The webpage redirected too many times.')


def parse_webpage(url: str, *, resolver=socket.getaddrinfo, connection_factory=None) -> SourceSnapshot:
    started = time.perf_counter()
    extracted, final_url, media_type, retrieved_at, _ = fetch_webpage(url, resolver=resolver, connection_factory=connection_factory)
    parsed_url = urlsplit(url)
    original = urlunsplit((parsed_url.scheme, parsed_url.netloc, parsed_url.path, '', ''))
    plain = extracted if media_type == 'text/plain' else extracted
    refs: list[SourceReference] = []
    if plain:
        refs.append(SourceReference(kind='webpage_text', url=final_url, start_char=0,
                                    end_char=len(plain), excerpt=plain[:500]))
    return _snapshot('webpage', _safe_name(urlsplit(final_url).hostname or 'Public webpage', 'Public webpage'),
                     media_type, plain, refs, started, original_url=original, final_url=final_url,
                     retrieved_at=retrieved_at, references_complete=True)

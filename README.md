# Download Mover

Firefox extension that sorts downloads into subfolders of your Downloads
directory based on URL-matching rules.

## Install (temporary)

1. Open `about:debugging` → *This Firefox* → **Load Temporary Add-on…**
2. Select `manifest.json` in this directory.
3. Click the extension's **Options** (or open it from `about:addons`).

Temporary add-ons are removed when Firefox restarts. For persistent install,
the extension needs to be signed by Mozilla.

## Rule syntax

One rule per line in the options textarea:

```
<url-regex> => <target-path>
```

- `<url-regex>` — JavaScript regex, tested as a substring against both the
  download URL and its referrer. The first match wins.
- `<target-path>` — folder (relative to Downloads) where the file should
  land. `~/Downloads/` and `~/` prefixes are stripped. Intermediate folders
  are created automatically.
- Named capture groups `(?<name>...)` in the regex are substituted as
  `{name}` in the path. Numbered groups `{1}`, `{2}`, … also work.
- Lines starting with `#` are comments.

### Example

```
zendesk\.com/agent/tickets/(?<ticket>[^/?#]+) => zendesk/{ticket}
```

A download whose URL or referrer contains `.../tickets/123/...` lands
in `~/Downloads/zendesk/123/<original-filename>`.

## Debug logging

Tick **Verbose logging** in the options page, then open the background
console via `about:debugging` → *Inspect* on the extension. Every download
prints the URL, referrer, and which rule (if any) matched.

## Limitations

- **Downloads folder only.** Firefox WebExtensions cannot write outside the
  Downloads directory. Arbitrary paths (e.g. `~/Projects/...`) would require
  a native messaging host.
- **Cancel-and-reissue.** Firefox has no `onDeterminingFilename` event, so
  matched downloads are canceled and re-issued as GET via
  `downloads.download()`. A few bytes of the original may hit disk before
  cancellation. Downloads that require POST or special auth beyond cookies
  may 404 on reissue.
- **Collision suffix stripping.** If Firefox suggests `log(2).txt` because
  `log.txt` already exists in Downloads, the extension strips `(2)` before
  placing the file in the target folder. If the target folder already
  contains the same filename, `conflictAction: "uniquify"` appends a fresh
  suffix there.

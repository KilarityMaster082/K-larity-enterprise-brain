# Third-Party Notices

> Owner task: EB-76 Licence verdicts and Borrow Register sign-off
> Canonical policy: Notion Document Hub → Licence Register v1.1. Per-feature status: [docs/borrow/BORROW_MAP.md](docs/borrow/BORROW_MAP.md).

K!larity Enterprise Brain includes source code copied from the projects below. Each is vendored
verbatim under `third_party/<tool>/` at a pinned commit, with its full licence text in
`third_party/<tool>/LICENSE` and a per-file SHA-256 manifest in `third_party/<tool>/UPSTREAM.yaml`.
Code adapted from these files into K!larity paths carries a `Borrowed from:` line naming the tool,
commit and upstream file.

No file from any `ee/` or `enterprise/` directory is included. Those directories are under
commercial licences and are refused by `ops/ci/vendor_upstream.py` and `ops/ci/check_structure.py`.

| Project | Upstream | Commit | Licence (portion used) | Copyright |
|---|---|---|---|---|
| Onyx | https://github.com/onyx-dot-app/onyx | a18fc1a652ff2b67ef7b1aae59dbfed013739365 | MIT (Expat), `ee/` excluded | Copyright (c) 2023-present DanswerAI, Inc. |
| Activepieces | https://github.com/activepieces/activepieces | 611db01a865b84a0f900f4b078de275d43529423 | MIT (Expat), `packages/ee` and `server/api/src/app/ee` excluded | Copyright (c) 2020-2024 Activepieces Inc. |

## Explicit exclusions

- `backend/onyx/utils/encryption.py` (Onyx) is MIT-licensed but is **not** copied, because it stores connector credentials as plaintext (Risk R-12).
- Runtime dependencies (Docling, ezdxf, Langfuse, OpenFGA, Temporal) are installed as packages, not copied. Their notices are produced by the dependency licence scan in CI.

## MIT licence text (applies to both projects above, outside their `ee` directories)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

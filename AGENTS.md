# asciiweave: Development Instructions for AI Agents

## Project goal

asciiweave is a HackMD-like collaborative web editor for AsciiDoc.

The primary workflow is:

1. Create an AsciiDoc document in the web application.
2. Give it a stable, shareable URL.
3. Let multiple colleagues edit that document in real time.
4. Show AsciiDoc source in CodeMirror 6 on the left.
5. Show live HTML rendered by Asciidoctor.js on the right.
6. Let users download the `.adoc` source and commit it to their own Git
   repository.

Git integration is not part of asciiweave.

The collaborative editor, presence, durable CRDT persistence, local and
Cloudflare server targets, deployment workflows, and plain-source export are
implemented. Preserve these properties when extending the application.

Core design principles, technology choices, compatibility requirements, and
server target design are documented in
[`docs/architecture.md`](docs/architecture.md).
The current product contract is documented in
[`docs/requirements.md`](docs/requirements.md).
Testing requirements and commands are documented in
[`docs/testing.md`](docs/testing.md).

---

## Work discipline for AI agents

1. Inspect the repository before changing its architecture.
2. Keep changes focused on the requested behavior.
3. Avoid speculative abstractions and unnecessary dependencies.
4. Pin dependency versions.
5. Follow [`docs/testing.md`](docs/testing.md): add or update tests for behavior
   changes and run the checks appropriate to the change.
6. Document commands needed to run the result.
7. Record architectural decisions that are not obvious from the code.
8. Preserve the separation between browser editing/rendering and server
   persistence/collaboration.
9. Check current upstream documentation before adapting to a changed API; do
   not work around mismatches by inventing synchronization protocols.

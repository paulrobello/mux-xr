# Terminal protocol provenance

`terminal_pb.ts` is the generated `protoc-gen-es` 2.16.0 schema from Paul Robello's MIT-licensed `par-term-emu-core-rust` web frontend. It is copied from the v0.77.0 tag at pinned core commit `f1059d42cbaa8c744ffdf53794f4ec7a8ce6ae14`. This revision includes the published damage metadata and pane-create protocol messages while preserving the existing generated message APIs.

SHA-256: `74568289834b31bf654307ce151f5928472f1b33a9a92f5b1b8c4fd0dba894fe`.

The source of truth is core `proto/terminal.proto` at the pinned revision; its web frontend generation command is `bun run proto:generate`. The v0.77 protocol documents raw SGR bits 64 and 65, optional damage ranges/generation, and optional pane creation, but this client only vendors the generated compatibility surface for now. Update from a verified compatible core revision, preserve the generated file, and rerun the framing/metadata tests. The wrapper in `../protocol.ts` handles the existing one-byte compression flag and bounded zlib framing. It does not redefine the protobuf wire format.

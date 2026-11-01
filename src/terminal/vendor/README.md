# Terminal protocol provenance

`terminal_pb.ts` is the generated `protoc-gen-es` 2.16.0 schema from Paul Robello's MIT-licensed `par-term-emu-core-rust` web frontend. It was copied from the hierarchy implementation and verified identical after its merge into core local main `95dbb69f1d8ee5d655361c19334a192c10c4c8e8`.

SHA-256: `40468d8603bf6e8a254cf3a84f3dba149d1fee57fe284c19cfda446a386e0eae`.

The source of truth is core `proto/terminal.proto`; the generation command in its web frontend is `bun run proto:generate`. Update from a verified compatible core revision, preserve the generated file, and rerun the framing/metadata tests. The wrapper in `../protocol.ts` handles the existing one-byte compression flag and bounded zlib framing. It does not redefine the protobuf wire format.

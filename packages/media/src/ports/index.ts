/** Pure logic ported from the AutoShorts desktop app (`src-tauri/src/*.rs`).
 *  Nothing here performs I/O; callers spawn the argv these builders return. */
export * from "./youtube";
export * from "./render-command";
export * from "./caption-chunks";
export * from "./transcript-normalize";
export * from "./facetrack-plan";
export { rustFixed } from "./rust-format";

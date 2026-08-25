// Command mt5-migration-gate is intentionally inert outside `go test`.
// The repository gauntlet executes the test-only implementation in
// gate_test.go so verifier code cannot enter a production build.
package main

func main() {}

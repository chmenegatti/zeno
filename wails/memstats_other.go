//go:build !linux

package main

// processTree: fora do Linux só o resumo do runtime Go por enquanto (#159)
func processTree(int) []procMem { return nil }

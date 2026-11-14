// Package webui はビルド済みのフロントエンド (dist/) を埋め込んで提供する
package webui

import (
	"embed"
	"io/fs"
)

//go:embed all:dist
var dist embed.FS

// FS は dist/ をルートとするファイルシステムを返す。
func FS() fs.FS {
	sub, err := fs.Sub(dist, "dist")
	if err != nil {
		panic(err)
	}
	return sub
}

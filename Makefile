# MD Writer 一站式构建脚本
# 用法：
#   make            # 等价于 make all
#   make dev        # 仅前端 watch 模式
#   make app        # 完整打包：前端 + 原生 + 组装 .app
#   make test       # 跑逻辑 + DOM 自检
#   make clean      # 清理产物

.PHONY: all dev build native pack finalize app dist dmg pkg sign notarize verify-sign \
        test selftest selftest-dom clean run

NODE    ?= node
PYTHON  ?= python3
SWIFT   ?= swiftc

all: app

# --- 前端 ---
build:
	$(NODE) build/build.mjs

dev:
	$(NODE) build/build.mjs --watch

# --- 原生 ---
native:
	$(SWIFT) -O -o build/MDWriter native/main.swift

# --- 打包 ---
pack: build
	$(PYTHON) build/pack-app.py

finalize:
	$(PYTHON) build/finalize.py

app: native pack finalize

# --- 分发产物（无需开发者账号）---
dmg: app
	$(PYTHON) build/make-dmg.py

pkg: app
	$(PYTHON) build/make-pkg.py

dist: app dmg pkg

# --- 签名 / 公证（需要 Apple Developer Program）---
sign: app
	$(PYTHON) build/notarize.py

notarize: app
	$(PYTHON) build/notarize.py --dmg --pkg

verify-sign:
	$(PYTHON) build/notarize.py --check

# --- 测试 ---
selftest:
	$(NODE) build/selftest.mjs

selftest-dom:
	$(NODE) build/selftest-dom.mjs

test: selftest selftest-dom

# --- 运行 ---
run:
	./native/MDWriter.app/Contents/MacOS/MDWriter

# --- 清理 ---
clean:
	rm -rf build/MDWriter
	rm -rf native/MDWriter.app/Contents/Resources/web

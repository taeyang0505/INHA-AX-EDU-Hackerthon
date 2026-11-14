#!/bin/bash
# LOOKteracy 실행 (Mac). 이 파일을 더블클릭하면 로컬 서버를 켜고 브라우저를 엽니다.
cd "$(dirname "$0")" || exit 1
PORT="${PORT:-4186}"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js가 설치되어 있지 않습니다."
  echo "https://nodejs.org 에서 LTS 버전을 설치한 뒤 이 파일을 다시 실행하세요."
  read -r -p "Enter를 누르면 창이 닫힙니다." _
  exit 1
fi
if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "$PORT 포트를 이미 다른 프로그램이 쓰고 있습니다."
  echo "LOOKteracy 창이 이미 열려 있다면 그 창을 닫거나, 터미널에서 다음처럼 실행하세요:"
  echo "  PORT=4187 ./start-mac.command"
  read -r -p "Enter를 누르면 창이 닫힙니다." _
  exit 1
fi
echo "LOOKteracy를 시작합니다. 이 창을 닫거나 Ctrl+C를 누르면 서버가 꺼집니다."
(sleep 1.5; open "http://127.0.0.1:$PORT") &
node scripts/serve.mjs --port "$PORT"

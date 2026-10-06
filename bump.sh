#!/bin/sh
# 사이트 파일을 고친 뒤 실행: 브라우저가 예전 파일을 쓰지 않도록 버전 번호를 바꾼다
V=$(date +%Y%m%d%H%M)
sed -i -E "s#(style\.css|chart\.umd\.js|config\.js|engine\.js|advisor\.js|app\.js)\?v=[0-9]+#\1?v=$V#g" docs/index.html
echo "version $V"

---
disable-model-invocation: true
argument-hint: "<uuid> <메시지> [--skill <스킬명>]"
---

$ARGUMENTS에서 첫 토큰을 to_id로, `--skill <이름>`이 있으면 떼어 skill로, 나머지를 message로 하여 roster의 send_message 도구를 호출해. 결과를 그대로 보고해. 인자가 없으면 사용법만 출력하고 멈춰.

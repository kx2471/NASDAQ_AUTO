계획 1. 매일 한번은 너무 많은거같아서 일주일에 한번 보고서 작성.
- 보고서를 매주 월요일 오후 3시에 발송
- 예외적으로 월요일이 나스닥이 개장하지 않는 날이라면(ex 공휴일 등) 가장 빠른 개장하는 날에 발송
- 보내는 방식은 똑같이 메일로 각각 GPT5, Gemini pro, Claude Opus로 내 이메일(kx2471@gmail.com) 으로 발송


계획 2. 일주일에 한번 하는 만큼 더 상세한 보고서필요
- 보고서 3종을 보내는 주체를 Agent로 명칭 (GPT5 = Agent_GPT, Gemini = Agent_Gemini, Claude = Agent_Claude)
- Agent들의 보고서 3종을 종합하여 최종의견을 도출해서 나에게 주는 Manager_Agent 생성
- Manager_Agent 의 모델은 GPT5로 설정
- Manager_Agent 가 통합한 보고서는 계획 1에서 발송하는 날의 16:00에 발송할 것
- 통합하여 보고하는 보고서는 다음 형식으로 제공되어야 함
    - 현재 포트폴리오
    - 목표 달성률
    - 포트폴리오 현황
    - 매매 의견 (현재 보유종목, 추천 매수종목 종합하여 의견 제공)

- 통합하여 보고하는 보고서는 간결하지만 확실한 지시사항으로 내려져야함 (ex 매매의견 : 현재 보유하고 있는 주식 A를 N주 매도하고 추천종목 B를 N주 매수하세요. B의 익절가는 N$이며, 손절가는 N$로 설정하세요.)

계획 3. Agent들의 보고서에서 섹터 추가
- technology 섹터 추가
- aerospace 섹터 추가
- defense 등의 섹터 추가
- computing, ai, nuclear, technology, aerospace, defense 이렇게 6개의 섹터로 구성


## 주의사항
- CLAUDE.md 준수
- Manager_Agent의 프롬프트가 따로 필요하다면 폴더 최상위에 promptManager.md 로 따로 생성하여 관리
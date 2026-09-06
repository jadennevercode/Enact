-- Keep the stable `mika` system key and API contract, but migrate the
-- product-owned display copy that members see to the Enact brand.
UPDATE agent
SET
    name = CASE
        WHEN name = 'Mika' THEN 'Enact'
        ELSE name
    END,
    description = CASE description
        WHEN 'Your workspace Chief of Staff. Mika turns goals into issues, coordinates agents, and helps build reusable workflows.'
            THEN 'Your workspace Chief of Staff. Enact turns goals into issues, coordinates agents, and helps build reusable workflows.'
        WHEN '你的工作区 Chief of Staff。Mika 会把目标转化为任务、协调智能体，并帮你建立可复用的工作流。'
            THEN '你的工作区 Chief of Staff。Enact 会把目标转化为任务、协调智能体，并帮你建立可复用的工作流。'
        WHEN '워크스페이스의 Chief of Staff입니다. Mika가 목표를 태스크로 구체화하고 에이전트를 조율하며 재사용 가능한 워크플로 구성을 돕습니다.'
            THEN '워크스페이스의 Chief of Staff입니다. Enact가 목표를 태스크로 구체화하고 에이전트를 조율하며 재사용 가능한 워크플로 구성을 돕습니다.'
        WHEN 'ワークスペースの Chief of Staff。Mika は目標をタスクに落とし込み、エージェントを調整し、再利用できるワークフローづくりを支援します。'
            THEN 'ワークスペースの Chief of Staff。Enact は目標をタスクに落とし込み、エージェントを調整し、再利用できるワークフローづくりを支援します。'
        ELSE description
    END
WHERE system_key = 'mika';

UPDATE chat_session AS session
SET title = replace(session.title, 'Mika', 'Enact')
FROM agent
WHERE session.agent_id = agent.id
  AND agent.system_key = 'mika'
  AND session.title LIKE '%Mika%';

UPDATE chat_message
SET content = replace(content, 'Mika', 'Enact')
WHERE message_kind = 'onboarding_opening'
  AND content LIKE '%Mika%';

UPDATE issue
SET description = replace(description, 'Mika', 'Enact')
WHERE origin_type = 'workspace_setup'
  AND description LIKE '%Mika%';

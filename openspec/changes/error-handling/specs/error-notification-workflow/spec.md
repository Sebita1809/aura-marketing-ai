## ADDED Requirements

### Requirement: A dedicated error workflow notifies the user when a workflow fails
The system SHALL provide a separate workflow (`error-workflow.json`) that n8n starts automatically via an Error Trigger node (`n8n-nodes-base.errorTrigger`) whenever any workflow in the n8n space fails after exhausting its retries. The error workflow SHALL notify the user in Spanish that an error occurred and how to retry. The workflow SHALL contain three nodes: the Error Trigger, a Code node (`n8n-nodes-base.code`) that extracts the chat id and builds the message, and a Telegram node (`n8n-nodes-base.telegram`, `sendMessage`) that reuses the existing `Telegram account` credential. The message SHALL be sent to the extracted user chat id when one is available, and to a configured default admin chat otherwise.

#### Scenario: Error workflow fires on a failed execution
- **WHEN** a workflow execution fails and the error workflow is selected in n8n Settings → Error Workflow
- **THEN** the error workflow starts with an Error Trigger item carrying `executionId`, `error`, `workflow`, `workflowId` and `lastNodeExecuted`

#### Scenario: User chat id is available in the error payload
- **WHEN** the error item exposes a user chat id (directly as `id_chat` or through the legacy `node.data[0].json.chat.id` field)
- **THEN** the Code node extracts it and the Telegram node sends the Spanish error message to that chat

#### Scenario: User chat id is not available
- **WHEN** the error item does not contain a user chat id and `DEFAULT_ADMIN_CHAT_ID` is configured in the Code node
- **THEN** the Telegram node sends the error message (with technical detail: workflow, last node executed, execution id) to the admin chat

#### Scenario: No chat target can be resolved
- **WHEN** the error item has no user chat id and `DEFAULT_ADMIN_CHAT_ID` is not configured
- **THEN** the error workflow does not send a message and the failure remains visible only in the n8n execution log

### Requirement: The error notification message is in Spanish and actionable
The message sent to the user SHALL be in Spanish, SHALL state that an error occurred while processing the request, and SHALL instruct the user to retry with `/start`. The message sent to the admin SHALL additionally include the workflow name, the last executed node and the execution id for debugging.

#### Scenario: User-facing message content
- **WHEN** the error workflow resolves a user chat id
- **THEN** the sent text contains a Spanish error notice and the instruction to retry with `/start`

#### Scenario: Admin-facing message content
- **WHEN** the error workflow falls back to the admin chat
- **THEN** the sent text contains the workflow name, `lastNodeExecuted` and `executionId`

### Requirement: The error workflow is verifiable offline and installable manually
The error workflow SHALL be a valid n8n export file that parses as JSON, contains exactly one `errorTrigger` node, one Code node and one Telegram `sendMessage` node, and reuses the `Telegram account` credential. Installing it (importing the file and selecting it as the error workflow in n8n Settings) SHALL be a documented pending-manual step because it requires the live n8n UI.

#### Scenario: Offline validation of the error workflow file
- **WHEN** `tests/error-handling/verify-retries.js` validates `error-workflow.json`
- **THEN** the file parses as JSON and contains an `errorTrigger` node, a Code node and a Telegram node with a `sendMessage` operation

#### Scenario: Manual installation and functional failure test
- **WHEN** the user imports `error-workflow.json` in n8n, selects it in Settings → Error Workflow, and forces a failure (e.g. stops a service or sends a bad request)
- **THEN** the user receives the Spanish error notification on Telegram

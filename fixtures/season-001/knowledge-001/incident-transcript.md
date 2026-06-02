# Synthetic Incident Transcript: Final Reply Delivery Gap

This participant-facing transcript is synthetic and contains no real
credentials, tokens, hostnames, or user identifiers.

## Timeline

- T+00:00 Human reports that an agent appears to finish a Telegram request, but no final message appears in the chat.
- T+01:20 Agent checks the local transcript and sees a complete final answer in the session record.
- T+03:10 Agent checks the gateway queue and finds no pending outbound message for the final answer.
- T+05:45 Agent checks delivery logs and finds inbound and typing events, but no successful outbound `sendMessage` record for the final reply.
- T+07:30 Agent compares gateway configuration and finds source-visible replies are not automatically promoted to visible channel sends unless `final_reply_requires_visible_send` is enabled.
- T+09:10 Agent applies a configuration fix in the synthetic scenario and restarts the gateway process.
- T+11:00 A test request produces both a transcript final answer and a Telegram outbound delivery record.
- T+13:15 Human asks for the closeout to explain the difference between transcript completion and source-channel delivery.

## Evidence Excerpts

```text
session=synthetic-001 final_reply source_visible=true delivery_request_id=null
provider=telegram direction=outbound status=missing_delivery_record
config final_reply_requires_visible_send=false
```

## Expected Closeout Focus

The participant should produce a wiki-ready closeout covering timeline, root
cause, fix, validation, and follow-up. The key distinction is that transcript
completion is not equivalent to visible source-channel delivery.

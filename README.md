# LLM Thingy

## Purpose
Companies like T. Rowe Price use LLMs extensively for vertification and market analysis. It's important to prevent things like PII, company secrets, and other sensitive data from going to Anthropic, OpenAI, or Google. Even if they get audited and are found to protect the data well, they should not get unnecessary PII in the first place as a matter of data security.

## LLM Credits
I think API has a free API.
Must buy $10 of Claude AI credits.
Maybe buy some OpenAI credits.
Focus on OpenAI-supported.

## Ideas

Jose & Tyler

- [ ] Runs in Docker, should be very easy to setup
- [ ] Support Gemini (and enter that track), Claude, ChatGPT OpenAI
- [x] Custom LLM chat frontend, designed by Tyler, separate for proof-of-concept
- [x] Start by recognizing PII using set rules like regex formats
- [x] Detect PII using a small, local LLM model
- [x] Potentially replace known PII with placeholders rather than erasing altogether
- [x] In certain cases, maybe reject promtps entirely
- [x] Open-source and free
- [ ] Audit log perhaps using Merkle Trees for data security and verifiability
- [x] Allow users and roles so users can do prompts, IT can review prompts, etc.
- [x] Allow user to override detections if not 100% certain that it's PII, explain risks
- [x] Configurable so the business can change settings
- [ ] Before switching to a non-local model, we can offer a warning
- [ ] Outline that the success depends on how large our local model is
- [ ] Make sure to benchmark and support dozens or hundreds of concurrent users making requests and prompting
- [ ] Detecting unauthorized prompting through either a forced HTTP proxy, or intercepting requests to LLM-related IPs and TLS SNI
- [ ] Start with small scope, expand as needed, do not allow creep
- [ ] Custom keywords, so we prevent internal names and trade secrets from being shared
- [x] Start without streaming, add streaming later
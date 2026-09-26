# LLM Thingy

Jose & Tyler

- Runs in Docker, should be very easy to setup
- Support Gemini (and enter that track), Claude, ChatGPT OpenAI
- Custom LLM chat frontend, designed by Tyler, separate for proof-of-concept
- Start by recognizing PII using set rules like regex formats
- Detect PII using a small, local LLM model
- Potentially replace known PII with placeholders rather than erasing altogether
- In certain cases, maybe reject promtps entirely
- Open-source and free
- Audit log perhaps using Merkle Trees for data security and verifiability
- Allow users and roles so users can do prompts, IT can review prompts, etc.
- Allow user to override detections if not 100% certain that it's PII, explain risks
- Configurable so the business can change settings
- Before switching to a non-local model, we can offer a warning
- Outline that the success depends on how large our local model is
- Make sure to benchmark and support dozens or hundreds of concurrent users making requests and prompting
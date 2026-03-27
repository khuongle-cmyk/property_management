# Voice Assistant - Phase 1 Specification

## Goal
Ship a simple working voice assistant for browser users with text fallback, multilingual input, and three actionable commands:

1. Check room availability
2. Create booking
3. Show open invoices

## Scope
- Floating microphone button on every page (bottom-right)
- Slide-up assistant panel
- Microphone capture via browser APIs
- Speech-to-text with OpenAI Whisper API
- Intent recognition with Anthropic Claude API
- Structured action execution in backend
- Text response shown in panel
- Command telemetry stored in `voice_commands`

## Out of Scope (Phase 2+)
- ElevenLabs spoken responses
- Confirmation flow for critical actions
- Full manager/owner and tenant command catalog
- Multi-turn conversations and memory
- Mobile app SDK integration

## Supported Languages
- `fi`, `sv`, `no`, `da`, `en`, `de`, `fr`, `es`, `ru`, `et`
- Current implementation stores selection in local storage (`voice.assistant.language`)
- Server also checks auth user metadata `language` when available

## User Experience
1. User opens voice assistant from floating mic button.
2. User starts microphone recording.
3. Recording auto-stops after ~2 seconds of silence (or user stops manually).
4. Audio is sent to `/api/voice-assistant/process`.
5. Backend transcribes with Whisper.
6. Transcribed text is classified by Claude into structured intent JSON.
7. Backend executes one of 3 supported actions.
8. Assistant text reply is shown in panel and command is logged.

Text fallback:
- User can type a command in panel input and send it without microphone.

## Technical Design

### Frontend
- Component: `src/components/VoiceAssistantWidget.tsx`
- Mounted globally in: `src/app/layout.tsx`
- UI states:
  - `idle`
  - `recording`
  - `processing`
  - `speaking` (reserved for phase 2 TTS)

### Backend
- Endpoint: `POST /api/voice-assistant/process`
- File: `src/app/api/voice-assistant/process/route.ts`
- Input:
  - Multipart form with:
    - `audio` (optional)
    - `text` (optional)
    - `language`
    - `pagePath`
- Output:
  - `transcribedText`
  - `intent` object
  - `result.responseText`
  - source metadata

### Action Handlers (Phase 1)
1. `check_room_availability`
   - Uses `bookable_spaces` and overlap check against `bookings`
2. `create_booking`
   - Creates `bookings` row for `registered_user`
3. `show_open_invoices`
   - Reads `lease_invoices` where status in `sent`, `overdue`

## Security and Access
- Requires authenticated user (`supabase.auth.getUser()`)
- Property scope derived from memberships/tenant scope
- Uses row-level security for action queries/inserts

## Telemetry
- SQL migration: `sql/voice_assistant_phase1.sql`
- Table: `public.voice_commands`
  - `id`, `user_id`, `tenant_id`, `language`
  - `transcribed_text`, `intent`, `parameters`
  - `action_taken`, `success`, `created_at`

## Required Environment Variables
- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `ELEVENLABS_API_KEY` (reserved for Phase 2)

Defined in `.env.local.example`.

## Test Checklist
- Open assistant on any page
- Record speech in at least 2 languages
- Verify Whisper transcription appears in chat history
- Verify each intent works:
  - availability
  - create booking
  - open invoices
- Verify text fallback command works
- Verify command rows appear in `voice_commands`

## Known Limitations
- No spoken output yet (text only)
- No explicit confirmation step before mutations
- Date/time parsing relies on Claude extraction + defaults
- Language preference not yet surfaced in dedicated profile settings page

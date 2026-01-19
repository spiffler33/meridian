/**
 * Edge Function: parse-task
 *
 * Parses natural language task input using Claude API.
 * Keeps API key server-side (secure, no CORS issues).
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages'

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      },
    })
  }

  try {
    // Create Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Get auth token and user (optional - fallback to service key)
    const authHeader = req.headers.get('Authorization')
    let userId: string | null = null

    if (authHeader) {
      const supabaseWithAuth = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
        global: { headers: { Authorization: authHeader } },
      })
      const { data: { user } } = await supabaseWithAuth.auth.getUser()
      userId = user?.id || null
    }

    // Get request body
    const { input, apiKey: clientApiKey } = await req.json()
    if (!input || typeof input !== 'string') {
      return new Response(JSON.stringify({ error: 'Missing input' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      })
    }

    // Try to get API key: from user profile, or from request
    let claudeApiKey = clientApiKey

    if (!claudeApiKey && userId) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('claude_api_key')
        .eq('id', userId)
        .single()
      claudeApiKey = profile?.claude_api_key
    }

    if (!claudeApiKey) {
      return new Response(JSON.stringify({ error: 'No Claude API key' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      })
    }

    // Build prompt
    const today = new Date().toISOString().split('T')[0]
    const dayOfWeek = new Date().toLocaleDateString('en-US', { weekday: 'long' })
    const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0]

    const prompt = `You are parsing a brain dump into structured tasks. Extract ALL distinct tasks mentioned.

Today: ${dayOfWeek}, ${today}

INPUT: "${input}"

Extract as JSON array - one object per task:
[
  {
    "text": "core task in 2-6 words (verb + object)",
    "status": "active" | "waiting" | "someday",
    "waitingOn": "person/thing if waiting, else omit",
    "expectsBy": "YYYY-MM-DD if date mentioned for THIS task, else omit",
    "effort": "quick" | "medium" | "deep",
    "isEvent": true | false
  }
]

Status rules:
- "waiting" = blocked on someone else (waiting on X, need response from, their turn)
- "someday" = low priority (someday, maybe, eventually, when I have time)
- "active" = I can act now (default)

isEvent rules - THIS IS CRITICAL:
- false = ACTION (something you DO): call, email, send, buy, prepare, submit, pay, cancel, fix, write, review, book
- true = EVENT (something you SHOW UP to): appointment, meeting, dentist, doctor, flight, dinner, birthday, concert, interview, wedding

Key distinction:
- "dentist friday" → isEvent: true (you show up at appointment)
- "call dentist" → isEvent: false (you make the call)
- "meeting monday" → isEvent: true (you attend)
- "prepare for meeting" → isEvent: false (you do the prep)
- "mom's birthday tuesday" → isEvent: true (reminder to acknowledge)
- "buy mom birthday gift" → isEvent: false (action to complete)

Date parsing (today is ${today}):
- tomorrow = ${tomorrow}
- day names = next occurrence of that day
- "by friday", "before friday", "due friday" → deadline (isEvent should be false)
- "friday", "on friday", "friday 3pm" with event noun → isEvent: true

Important:
- Extract EVERY distinct task/item mentioned
- Each task gets its own object in the array
- Even single tasks return an array with one item
- Default isEvent to false if unclear

Return ONLY the JSON array:`

    // Call Claude API
    const claudeResponse = await fetch(CLAUDE_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': claudeApiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-3-5-haiku-20241022',
        max_tokens: 500,
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    if (!claudeResponse.ok) {
      const errText = await claudeResponse.text()
      console.error('Claude API error:', claudeResponse.status, errText)
      return new Response(JSON.stringify({ error: 'Claude API error', details: errText }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      })
    }

    const claudeData = await claudeResponse.json()
    const content = claudeData.content?.[0]?.text

    if (!content) {
      return new Response(JSON.stringify({ error: 'Empty response from Claude' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      })
    }

    // Parse and validate JSON array
    let parsed
    try {
      parsed = JSON.parse(content)
    } catch (parseErr) {
      console.error('JSON parse error:', parseErr, 'Content:', content)
      // Fallback: return input as single item
      return new Response(JSON.stringify({ items: [{ text: input.trim(), status: 'active' }] }), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      })
    }

    const items = Array.isArray(parsed) ? parsed : [parsed]

    const results = items.map((item: any) => ({
      text: typeof item.text === 'string' ? item.text.trim() : input.trim(),
      status: ['active', 'waiting', 'someday'].includes(item.status) ? item.status : 'active',
      waitingOn: item.status === 'waiting' && item.waitingOn ? item.waitingOn : undefined,
      expectsBy: /^\d{4}-\d{2}-\d{2}$/.test(item.expectsBy) ? item.expectsBy : undefined,
      effort: ['quick', 'medium', 'deep'].includes(item.effort) ? item.effort : undefined,
      isEvent: item.isEvent === true,  // Default to false if not explicitly true
    }))

    return new Response(JSON.stringify({ items: results }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    })
  } catch (err) {
    console.error('Edge function error:', err)
    return new Response(JSON.stringify({ error: 'Internal error', message: String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    })
  }
})

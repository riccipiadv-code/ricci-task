import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders, processNotifyTaskAssignment } from '../_shared/notify-task-assignment-core.ts'

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
  const supabase = createClient(supabaseUrl, supabaseKey)

  return processNotifyTaskAssignment(req, {
    supabase,
    getEnv: (k: string) => Deno.env.get(k),
  })
})

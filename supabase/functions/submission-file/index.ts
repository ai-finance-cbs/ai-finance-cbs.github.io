import { createClient } from 'npm:@supabase/supabase-js@2';
import { createHandler } from './handler.js';
Deno.serve(createHandler(createClient, (name: string) => Deno.env.get(name)));

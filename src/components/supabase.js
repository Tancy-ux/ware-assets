import { createClient } from "@supabase/supabase-js"

const supabaseUrl = "https://lauvnmdepcdjxilglubn.supabase.co"
const supabaseKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxhdXZubWRlcGNkanhpbGdsdWJuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMyODU0OTEsImV4cCI6MjA4ODg2MTQ5MX0.RX9uDma63V_zrT-m4taToVqUhIzMqDhfedC2edGOLd4"

export const supabase = createClient(supabaseUrl, supabaseKey)
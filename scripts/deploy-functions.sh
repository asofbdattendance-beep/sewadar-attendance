#!/bin/bash
# deploy-functions.sh
# Deploy all Supabase Edge Functions

echo "Deploying Supabase Edge Functions..."

# Check if supabase CLI is installed
if ! command -v supabase &> /dev/null; then
    echo "Error: Supabase CLI not installed"
    echo "Run: npm install -g supabase"
    exit 1
fi

# Link to project (uncomment and set your project ref)
# supabase link --project-ref YOUR_PROJECT_REF

# Deploy functions
echo "Deploying create-user function..."
supabase functions deploy create-user

echo "Deploying save-credential function..."
supabase functions deploy save-credential

echo "Done! Make sure to set environment variables in Supabase dashboard:"
echo "  - ALLOWED_ORIGIN"
echo "  - ANON_KEY"
echo "  - SUPABASE_URL"
echo "  - SERVICE_ROLE_KEY"

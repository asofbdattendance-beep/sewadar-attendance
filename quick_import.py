"""
Quick User Import - Run this directly
"""

import sys
import os
import csv
import datetime

SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imxuem5oYndna3VzZ2RjbXZnem5mIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjMzNjE4NywiZXhwIjoyMDkxOTEyMTg3fQ.NmiG1w_Fps6MRGeYkjijDVwwPReVyiiaeurUM7NOhO8"
SUPABASE_URL = "https://lnznhbwgkusgdcmvgznf.supabase.co"

ROLE_MAP = {
    'SUPER_ADMIN': 'super_admin',
    'ADMIN': 'admin',
    'CENTRE_ADMIN': 'centre_user',
    'CENTRE_USER': 'centre_user',
    'SC_SP_USER': 'sc_sp_user',
    'SCANNER': 'sc_sp_user',
    'USER': 'sc_sp_user',
}

from supabase import create_client, Client
supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

# Read CSV
with open('users_template.csv', 'r', encoding='utf-8') as f:
    reader = csv.DictReader(f)
    users = list(reader)

print(f"\n{'='*60}")
print(f"Bulk User Creation")
print(f"Users found: {len(users)}")
print(f"{'='*60}\n")

created = 0
failed = 0

for i, user in enumerate(users, 1):
    email = str(user.get('Email', '') or '').strip()
    password = str(user.get('Password', '') or '').strip()
    name = str(user.get('Name', '') or '').strip()
    role_input = str(user.get('Role', '') or '').strip()
    centre = str(user.get('Centre', '') or '').strip()
    badge_input = str(user.get('Badge_Number', '') or '').strip()
    
    if not email or not password:
        print(f"[{i}] SKIP - empty row")
        continue
    
    role = ROLE_MAP.get(role_input.upper(), 'sc_sp_user') if role_input else 'sc_sp_user'
    
    if not name:
        name = email.split('@')[0].replace('.', ' ').replace('_', ' ').replace('-', ' ').title()
    
    if badge_input:
        badge_number = badge_input.upper()
    else:
        timestamp = datetime.datetime.now().strftime("%m%d%H%M%S")
        prefix = {'super_admin': 'SA', 'admin': 'AD', 'centre_user': 'CU', 'sc_sp_user': 'SC'}.get(role, 'US')
        badge_number = f"{prefix}{timestamp[-6:]}{str(i).zfill(3)}"
    
    print(f"[{i}/{len(users)}] {email} -> {badge_number}")
    
    try:
        auth_response = supabase.auth.admin.create_user({
            "email": email,
            "password": password,
            "email_confirm": True
        })
        auth_id = auth_response.user.id
        
        user_data = {
            "auth_id": auth_id,
            "email": email,
            "name": name,
            "badge_number": badge_number,
            "role": role,
            "centre": centre or 'Gurugram',
            "is_active": True
        }
        
        supabase.table("users").insert(user_data).execute()
        print(f"    [OK] Created: {badge_number}")
        created += 1
        
    except Exception as e:
        error_msg = str(e)
        if 'already exists' in error_msg.lower():
            error_msg = "User already exists"
        print(f"    [FAIL] {error_msg}")
        failed += 1

print(f"\n{'='*60}")
print(f"DONE: {created} created, {failed} failed")
print(f"{'='*60}")

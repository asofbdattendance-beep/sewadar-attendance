"""
Supabase Bulk User Creation Script
Reads users from Excel/CSV file and creates them in Supabase

Usage:
  python bulk_create_users.py users.xlsx
  python bulk_create_users.py users.csv

Excel/CSV Headers:
  - Email (required)
  - Password (required)
  - Name (optional, defaults to email username)
  - Role (optional, defaults to SC_SP_USER)
  - Centre (optional, defaults to Gurugram)
  - Badge_Number (optional, auto-generated if not provided)
"""

import sys
import os
import csv
import datetime

# Fix Windows console encoding for Unicode characters
import io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

ROLE_MAP = {
    'SUPER_ADMIN': 'super_admin',
    'ADMIN': 'admin',
    'CENTRE_ADMIN': 'centre_user',
    'CENTRE_USER': 'centre_user',
    'SC_SP_USER': 'sc_sp_user',
    'SCANNER': 'sc_sp_user',
    'USER': 'sc_sp_user',
}

ROLE_PREFIXES = {
    'super_admin': 'SA',
    'admin': 'AD',
    'centre_user': 'CU',
    'sc_sp_user': 'SC',
}


def create_users_from_file(filepath: str):
    """
    Read users from Excel/CSV file and create them in Supabase.
    """
    
    from supabase import create_client, Client
    
    SUPABASE_URL = "https://lnznhbwgkusgdcmvgznf.supabase.co"
    SUPABASE_KEY = os.environ.get("SUPABASE_KEY", "")
    
    if not SUPABASE_KEY:
        print("✗ Error: SUPABASE_KEY environment variable not set")
        print("  Set it with: export SUPABASE_KEY='your-service-role-key'")
        return
    
    supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
    
    # Read file
    filename, ext = os.path.splitext(filepath)
    ext = ext.lower()
    
    users = []
    
    if ext == '.csv':
        with open(filepath, 'r', encoding='utf-8') as f:
            reader = csv.DictReader(f)
            users = list(reader)
    elif ext in ['.xlsx', '.xls']:
        try:
            import pandas as pd
            df = pd.read_excel(filepath)
            # Normalize column names (remove spaces, lowercase)
            df.columns = df.columns.str.strip().str.lower().str.replace(' ', '_')
            users = df.to_dict('records')
        except ImportError:
            print("✗ Error: pandas not installed. Run: pip install pandas openpyxl")
            return
    else:
        print(f"✗ Error: Unsupported file format: {ext}")
        print("  Supported formats: .csv, .xlsx, .xls")
        return
    
    if not users:
        print("✗ No users found in file")
        return
    
    print(f"\n{'='*60}")
    print(f"Bulk User Creation")
    print(f"File: {filepath}")
    print(f"Users found: {len(users)}")
    print(f"{'='*60}\n")
    
    # Show available columns
    print("Columns found:", list(users[0].keys()) if users else [])
    print()
    
    created = []
    failed = []
    
    for i, user in enumerate(users, 1):
        email = str(user.get('email', '') or '').strip()
        password = str(user.get('password', '') or '').strip()
        name = str(user.get('name', '') or '').strip()
        role_input = str(user.get('role', '') or '').strip()
        centre = str(user.get('centre', '') or '').strip()
        badge_input = str(user.get('badge_number', '') or '').strip()
        
        # Skip empty rows
        if not email or not password:
            print(f"[{i}/{len(users)}] ✗ Skipping empty row")
            continue
        
        # Map role
        role = ROLE_MAP.get(role_input.upper(), 'sc_sp_user') if role_input else 'sc_sp_user'
        
        # Generate name from email if not provided
        if not name:
            name = email.split('@')[0].replace('.', ' ').replace('_', ' ').replace('-', ' ').title()
        
        # Generate badge number if not provided
        if badge_input:
            badge_number = badge_input.upper()
        else:
            timestamp = datetime.datetime.now().strftime("%m%d%H%M%S")
            prefix = ROLE_PREFIXES.get(role, 'US')
            random_suffix = str(i).zfill(3)
            badge_number = f"{prefix}{timestamp[-6:]}{random_suffix}"
        
        print(f"[{i}/{len(users)}] Creating: {email}")
        print(f"         Name: {name}")
        print(f"         Role: {role} ({role_input or 'default'})")
        print(f"         Centre: {centre or 'default'}")
        print(f"         Badge: {badge_number}")
        
        try:
            # Step 1: Create auth user
            auth_response = supabase.auth.admin.create_user({
                "email": email,
                "password": password,
                "email_confirm": True
            })
            
            auth_id = auth_response.user.id
            print(f"         Auth ID: {auth_id}")
            
            # Step 2: Insert into users table
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
            
            created.append({
                "email": email,
                "badge_number": badge_number,
                "name": name,
                "role": role,
                "centre": centre or 'Gurugram'
            })
            
            print(f"         ✓ Created successfully\n")
            
        except Exception as e:
            error_msg = str(e)
            if 'already exists' in error_msg.lower():
                error_msg = "User already exists"
            print(f"         ✗ Failed: {error_msg}\n")
            failed.append({"email": email, "error": error_msg})
    
    # Summary
    print(f"{'='*60}")
    print(f"SUMMARY")
    print(f"{'='*60}")
    print(f"Total:    {len(users)}")
    print(f"Created:  {len(created)}")
    print(f"Failed:   {len(failed)}")
    print(f"{'='*60}\n")
    
    if created:
        print("Created Users:")
        print(f"{'Email':<35} {'Badge':<15} {'Role':<15} {'Centre'}")
        print("-" * 85)
        for u in created:
            print(f"{u['email']:<35} {u['badge_number']:<15} {u['role']:<15} {u['centre']}")
        print()
    
    if failed:
        print("Failed Users:")
        print(f"{'Email':<35} {'Error'}")
        print("-" * 65)
        for u in failed:
            print(f"{u['email']:<35} {u['error']}")
        print()


def list_users():
    """List all users from the users table."""
    from supabase import create_client, Client
    
    SUPABASE_URL = "https://lnznhbwgkusgdcmvgznf.supabase.co"
    SUPABASE_KEY = os.environ.get("SUPABASE_KEY", "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imxuem5oYndna3VzZ2RjbXZnem5mIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjMzNjE4NywiZXhwIjoyMDkxOTEyMTg3fQ.NmiG1w_Fps6MRGeYkjijDVwwPReVyiiaeurUM7NOhO8")
    
    if not SUPABASE_KEY:
        print("✗ Error: SUPABASE_KEY environment variable not set")
        return
    
    supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
    
    print(f"\n{'='*80}")
    print("All Users")
    print(f"{'='*80}")
    
    response = supabase.table("users").select("*").execute()
    
    if response.data:
        print(f"{'Badge':<18} {'Name':<25} {'Email':<30} {'Role':<15} {'Centre':<20} {'Active'}")
        print("-" * 110)
        for user in response.data:
            role_label = ROLE_MAP.get(user.get('role', '').upper(), user.get('role', ''))
            print(f"{user.get('badge_number', 'N/A'):<18} {user.get('name', 'N/A'):<25} {user.get('email', 'N/A'):<30} {role_label:<15} {user.get('centre', 'N/A'):<20} {'✓' if user.get('is_active') else '✗'}")
        print(f"\nTotal users: {len(response.data)}")
    else:
        print("No users found")
    
    print()


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        print("\nCommands:")
        print("  python bulk_create_users.py users.csv          Create users from CSV")
        print("  python bulk_create_users.py users.xlsx         Create users from Excel")
        print("  python bulk_create_users.py list              List all users")
        print("\nRole Mapping:")
        for csv_role, db_role in ROLE_MAP.items():
            print(f"  {csv_role:<15} → {db_role}")
        sys.exit(1)
    
    command = sys.argv[1].lower()
    
    if command == "list":
        list_users()
    else:
        filepath = sys.argv[1]
        
        if not os.path.exists(filepath):
            print(f"✗ File not found: {filepath}")
            sys.exit(1)
        
        create_users_from_file(filepath)


if __name__ == "__main__":
    main()

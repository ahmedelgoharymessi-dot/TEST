#!/usr/bin/env python3
"""
Firebase Config Updater for El Jasus Game
Updates firebaseConfig in all HTML files
"""

import os
import re

# NEW Firebase Config
NEW_CONFIG = '''
const firebaseConfig = {
  apiKey: "AIzaSyDnd-pmKEatI3DaFz6xHWB5ucurtHXt9tk",
  authDomain: "el-jasus.firebaseapp.com",
  databaseURL: "https://el-jasus-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "el-jasus",
  storageBucket: "el-jasus.firebasestorage.app",
  messagingSenderId: "415659587906",
  appId: "1:415659587906:web:782f7940176ea4097eb0db",
  measurementId: "G-N4K79FP56N"
};'''

# Files that contain Firebase config
FILES_TO_UPDATE = [
    'index.html',
    'room.html',
    'login.html',
    'signup.html',
    'account.html',
    'admin.html',
    'shop.html',
    'friends.html',
    'analytics.html',
    'profile.html',
    'leaderboard.html',
    'onlinerooms.html',
    'username.html',
    'password.html',
    'import-words.html'
]

def update_firebase_config(filepath):
    """Update Firebase config in a single file"""
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            content = f.read()
        
        # Pattern to match firebaseConfig declaration
        pattern = r'const firebaseConfig\s*=\s*\{[^}]+\};'
        
        if re.search(pattern, content):
            # Replace old config with new one
            new_content = re.sub(pattern, NEW_CONFIG, content)
            
            # Write back
            with open(filepath, 'w', encoding='utf-8') as f:
                f.write(new_content)
            
            return True, "✅ Updated"
        else:
            return False, "⚠️ No config found"
            
    except FileNotFoundError:
        return False, "❌ File not found"
    except Exception as e:
        return False, f"❌ Error: {str(e)}"

def main():
    print("=" * 60)
    print("🔥 Firebase Config Updater - El Jasus")
    print("=" * 60)
    print()
    
    # Get current directory
    current_dir = os.getcwd()
    print(f"📁 Working directory: {current_dir}")
    print()
    
    updated_count = 0
    not_found_count = 0
    error_count = 0
    
    for filename in FILES_TO_UPDATE:
        filepath = os.path.join(current_dir, filename)
        success, message = update_firebase_config(filepath)
        
        print(f"{message:20} {filename}")
        
        if success:
            updated_count += 1
        elif "not found" in message.lower():
            not_found_count += 1
        else:
            error_count += 1
    
    print()
    print("=" * 60)
    print(f"📊 Summary:")
    print(f"   ✅ Updated: {updated_count}")
    print(f"   ⚠️  Not found: {not_found_count}")
    print(f"   ❌ Errors: {error_count}")
    print("=" * 60)
    print()
    
    if updated_count > 0:
        print("🎉 Firebase config updated successfully!")
        print()
        print("📝 Next steps:")
        print("   1. Test signup on your website")
        print("   2. Try creating a room")
        print("   3. Check Firebase Console → Database → Rules")
    else:
        print("⚠️  Warning: No files were updated!")
        print("   Make sure you're running this in the correct directory.")

if __name__ == "__main__":
    main()
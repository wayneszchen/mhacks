#!/usr/bin/env python3
"""
Test script for StaffSpy functionality
"""

from staffspy import LinkedInAccount

def test_staffspy():
    """Test basic StaffSpy functionality"""

    print("🚀 Starting StaffSpy test...")
    print("🔐 Using credential-based login for WSL compatibility")
    print("⚠️  Make sure 2FA is disabled on your LinkedIn account\n")

    try:
        # For WSL: Use credentials instead of browser
        linkedin_email = input("Enter your LinkedIn email: ")
        linkedin_password = input("Enter your LinkedIn password: ")

        # Initialize LinkedIn account with credentials
        account = LinkedInAccount(
            username=linkedin_email,
            password=linkedin_password,
            session_file="session.pkl",  # Save login cookies
            log_level=2,  # Show all logs for debugging
        )

        print("✅ StaffSpy initialized successfully!")

        # Example: Search for OpenAI software engineers in London
        print("\n🔍 Searching for OpenAI software engineers...")
        company_name = input("company name: ")
        search_term = input("Role: ")
        staff = account.scrape_staff(
            company_name=company_name,
            search_term=search_term,
            location="USA",
            extra_profile_data=False,  # Start with basic data first
            max_results=10,  # Very small test
        )

        print(f"📊 Found {len(staff)} profiles")
        if len(staff) > 0:
            print("\n📋 Sample data columns:")
            print(staff.columns.tolist())

            print("\n👤 First profile sample:")
            print(staff.iloc[0].to_dict())

            # Save results
            staff.to_csv("google_engineers.csv", index=False)
            print("\n💾 Results saved to openai_engineers.csv")
        else:
            print("❌ No profiles found. Check your LinkedIn account quality.")

        return staff

    except Exception as e:
        print(f"❌ Error: {e}")
        print("💡 Make sure you have Chrome installed and your LinkedIn account is in good standing")
        return None

if __name__ == "__main__":
    test_staffspy()
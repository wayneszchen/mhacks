#!/usr/bin/env python3
"""
Staff Functions - LinkedIn data extraction using StaffSpy

This module provides functions to authenticate with LinkedIn and extract
staff data from companies. It can be used both as a library and as a CLI tool.
"""

from staffspy import LinkedInAccount, SolverType, DriverType, BrowserType
import os
import sys
import json
from pathlib import Path
from typing import Optional, Dict, Any
import pandas as pd


def init_account(username: str = "", password: str = "", session_file: str = "session.pkl") -> LinkedInAccount:
    """Initialize LinkedIn account with credentials and auto-load user profile"""
    try:
        account = LinkedInAccount(
            username=username,
            password=password,
            session_file=session_file,
            log_level=1,  # 0 for no logs
        )

        # Automatically parse and store user profile
        print("🔍 Auto-loading your profile...")
        user_profile = parse_user_profile_auto(account)

        if user_profile:
            # Store profile in the account object for easy access
            account.user_profile = user_profile

            # Also save to JSON file for persistence
            profile_file = session_file.replace('.pkl', '_profile.json')
            save_user_profile(user_profile, profile_file)

            print(f"✅ Profile loaded: {user_profile['name']} ({user_profile.get('university', 'N/A')})")
        else:
            print("⚠️ Could not auto-load profile")
            account.user_profile = None

        return account
    except Exception as e:
        raise Exception(f"Failed to initialize LinkedIn account: {str(e)}")


def scrape_company_staff(
    account: LinkedInAccount,
    company_name: str,
    search_term: str,
    location: str = "USA",
    max_results: int = 20,
    output_file: Optional[str] = None
) -> str:
    """
    Scrape staff from a company and save to CSV
    Returns the path to the generated CSV file
    """
    try:
        staff = account.scrape_staff(
            company_name=company_name,
            search_term=search_term,
            location=location,
            extra_profile_data=True,
            max_results=max_results,
        )
        
        # Generate output filename if not provided
        if not output_file:
            safe_company = company_name.lower().replace(' ', '_').replace('.', '')
            safe_role = search_term.lower().replace(' ', '_')
            output_file = f"{safe_company}_{safe_role}_staff.csv"
        
        # Save to CSV
        staff.to_csv(output_file, index=False)
        return output_file
        
    except Exception as e:
        raise Exception(f"Failed to scrape company staff: {str(e)}")

def extract_staff_data(
    username: str,
    password: str,
    company_name: str,
    search_term: str,
    location: str = "USA",
    max_results: int = 20
) -> Dict[str, Any]:
    """
    Complete workflow: authenticate and extract staff data
    Returns dict with results and metadata
    """
    try:
        # Initialize account
        account = init_account(username, password)
        
        # Scrape data
        csv_file = scrape_company_staff(
            account=account,
            company_name=company_name,
            search_term=search_term,
            location=location,
            max_results=max_results
        )
        
        # Read the CSV to get count and sample data
        df = pd.read_csv(csv_file)
        
        # Convert NaN values to None for JSON serialization
        sample_profile = None
        if len(df) > 0:
            sample_profile = df.iloc[0].to_dict()
            # Replace NaN values with None
            for key, value in sample_profile.items():
                if pd.isna(value):
                    sample_profile[key] = None
        
        return {
            "success": True,
            "csv_file": csv_file,
            "total_profiles": len(df),
            "columns": df.columns.tolist(),
            "sample_profile": sample_profile,
            "company": company_name,
            "role": search_term,
            "location": location
        }
        
    except Exception as e:
        return {
            "success": False,
            "error": str(e),
            "company": company_name,
            "role": search_term,
            "location": location
        }


def parse_search_prompt(prompt: str) -> Dict[str, str]:
    """
    Parse user search prompt to extract company, role, and location
    Example: "Find SWE contacts at Amazon in Seattle" -> {"company": "Amazon", "role": "SWE", "location": "Seattle"}
    """
    import re
    
    # Default values
    result = {
        "company": "",
        "role": "",
        "location": "USA"
    }
    
    # Extract company (after "at")
    company_match = re.search(r'\bat\s+([A-Za-z0-9\-\.& ]+?)(?:\s+in\s+|\s*$)', prompt, re.IGNORECASE)
    if company_match:
        result["company"] = company_match.group(1).strip()
    
    # Extract location (after "in")
    location_match = re.search(r'\bin\s+([A-Za-z\s,]+?)(?:\s*$)', prompt, re.IGNORECASE)
    if location_match:
        result["location"] = location_match.group(1).strip()
    
    # Extract role/position (common terms)
    role_patterns = [
        r'\b(software engineer|SWE|engineer|developer|dev)\b',
        r'\b(product manager|PM|product)\b',
        r'\b(data scientist|data engineer|ML engineer|AI engineer)\b',
        r'\b(designer|UX|UI)\b',
        r'\b(marketing|sales|business)\b'
    ]
    
    for pattern in role_patterns:
        role_match = re.search(pattern, prompt, re.IGNORECASE)
        if role_match:
            result["role"] = role_match.group(1)
            break
    
    # If no specific role found, look for general terms before "contacts"
    if not result["role"]:
        general_match = re.search(r'find\s+([A-Za-z\s]+?)\s+contacts', prompt, re.IGNORECASE)
        if general_match:
            result["role"] = general_match.group(1).strip()
    
    return result


def parse_user_profile(account: LinkedInAccount, user_linkedin_url: str = None, use_connection_method: bool = False) -> Dict[str, Any]:
    """
    Parse the authenticated user's own LinkedIn profile

    Args:
        account: Authenticated LinkedInAccount
        user_linkedin_url: Optional LinkedIn profile URL (e.g., "https://linkedin.com/in/username")

    Returns:
        Dictionary containing user's profile data
    """
    try:
        if not user_linkedin_url:
            # If no URL provided, we need to get it from the user
            print("💡 To parse your profile, please provide your LinkedIn profile URL")
            print("Example: https://linkedin.com/in/your-username")
            return None

        # Extract username from LinkedIn URL
        import re
        username_match = re.search(r'linkedin\.com/in/([^/?]+)', user_linkedin_url)
        if not username_match:
            raise Exception("Invalid LinkedIn URL format. Expected: https://linkedin.com/in/username")

        username = username_match.group(1)

        print(f"🔍 Parsing user profile: {username}")

        # Use StaffSpy to scrape the user's own profile
        user_profiles = account.scrape_users(
            user_ids=[username],
            extra_profile_data=True
        )

        if user_profiles.empty:
            raise Exception("Could not find user profile. Check the LinkedIn URL.")

        # Convert to dictionary
        user_data = user_profiles.iloc[0].to_dict()

        # Extract key information for matching
        profile_summary = {
            "name": user_data.get('name', ''),
            "headline": user_data.get('headline', ''),
            "current_position": user_data.get('current_position', ''),
            "current_company": user_data.get('current_company', ''),
            "location": user_data.get('location', ''),
            "skills": parse_skills_list(user_data.get('skills', '')),
            "experience": parse_experience_list(user_data.get('experiences', '')),
            "education": parse_education_list(user_data.get('schools', '')),
            "bio": user_data.get('bio', ''),
            "raw_data": user_data  # Keep full data for advanced matching
        }

        print(f"✅ Successfully parsed profile for {profile_summary['name']}")
        print(f"📋 Skills: {', '.join(profile_summary['skills'][:5])}")
        print(f"🏢 Current: {profile_summary['current_position']} at {profile_summary['current_company']}")

        return profile_summary

    except Exception as e:
        print(f"❌ Failed to parse user profile: {str(e)}")
        return None


def parse_skills_list(skills_str: str) -> list:
    """Extract skills from StaffSpy skills data"""
    try:
        if not skills_str or skills_str == 'nan':
            return []

        import json
        if skills_str.startswith('['):
            # JSON format: [{"name": "Python", "endorsements": 5}, ...]
            skills_data = json.loads(skills_str)
            return [skill.get('name', '') for skill in skills_data if isinstance(skill, dict)]
        else:
            # Simple comma-separated format
            return [skill.strip() for skill in skills_str.split(',') if skill.strip()]
    except:
        return []


def parse_experience_list(experiences_str: str) -> list:
    """Extract job titles and companies from experiences"""
    try:
        if not experiences_str or experiences_str == 'nan':
            return []

        import json
        if experiences_str.startswith('['):
            # JSON format: [{"title": "Software Engineer", "company": "Google"}, ...]
            exp_data = json.loads(experiences_str)
            return [f"{exp.get('title', '')} at {exp.get('company', '')}"
                   for exp in exp_data if isinstance(exp, dict)]
        else:
            return [experiences_str]
    except:
        return []


def parse_education_list(schools_str: str) -> list:
    """Extract schools and degrees from education data"""
    try:
        if not schools_str or schools_str == 'nan':
            return []

        import json
        if schools_str.startswith('['):
            # JSON format: [{"school": "Stanford", "degree": "CS"}, ...]
            school_data = json.loads(schools_str)
            return [f"{school.get('school', '')} - {school.get('degree', '')}"
                   for school in school_data if isinstance(school, dict)]
        else:
            return [schools_str]
    except:
        return []


def parse_user_profile_auto(account: LinkedInAccount) -> Dict[str, Any]:
    """
    Automatically parse the authenticated user's own LinkedIn profile using LinkedIn API

    Args:
        account: Authenticated LinkedInAccount

    Returns:
        Dictionary containing user's profile data focused on academic background
    """
    try:
        # Get basic profile info from LinkedIn API
        response = account.session.get("https://www.linkedin.com/voyager/api/identity/dash/profiles?q=memberIdentity&memberIdentity=me")

        if response.status_code != 200:
            raise Exception(f"Failed to get profile data: {response.status_code}")

        profile_data = response.json()

        if not profile_data.get('elements'):
            raise Exception("No profile data found in response")

        user_data = profile_data['elements'][0]

        # Extract basic information
        profile_summary = {
            "name": f"{user_data.get('firstName', '')} {user_data.get('lastName', '')}".strip(),
            "first_name": user_data.get('firstName', ''),
            "last_name": user_data.get('lastName', ''),
            "headline": user_data.get('headline', ''),
            "location": user_data.get('geoLocationName', ''),
            "public_identifier": user_data.get('publicIdentifier', ''),
            "profile_url": f"https://linkedin.com/in/{user_data.get('publicIdentifier', '')}" if user_data.get('publicIdentifier') else '',
            "student": user_data.get('student', False),
        }

        # Get detailed profile data (university, clubs, etc.)
        if profile_summary['public_identifier']:
            try:
                detailed_profiles = account.scrape_users([profile_summary['public_identifier']])

                if not detailed_profiles.empty:
                    detailed_data = detailed_profiles.iloc[0].to_dict()

                    # Extract academic-focused information using StaffSpy data
                    education = parse_education_list(detailed_data.get('experiences', []))
                    experiences = parse_experience_list(detailed_data.get('experiences', []))

                    # Get university from StaffSpy fields (same as CSV format)
                    university = detailed_data.get('school_1', 'N/A')
                    school_2 = detailed_data.get('school_2', '')

                    # Calculate academic year from schools data
                    academic_year, major = calculate_academic_status(detailed_data.get('schools', []))

                    # Filter for academic/club experiences
                    academic_roles = []
                    for exp in experiences:
                        if any(keyword in exp.lower() for keyword in ['university', 'college', 'research', 'lab', 'club', 'society', 'student']):
                            academic_roles.append(exp)

                    profile_summary.update({
                        "university": university,
                        "academic_year": academic_year,
                        "major": major,
                        "education": education,
                        "academic_roles": academic_roles,
                        "current_position": detailed_data.get('current_position', ''),
                        "current_company": detailed_data.get('current_company', ''),
                        "detailed_data": detailed_data
                    })

            except Exception as e:
                print(f"⚠️ Could not get detailed profile data: {e}")
                profile_summary.update({
                    "university": "N/A",
                    "academic_year": "N/A",
                    "major": "N/A",
                    "education": [],
                    "academic_roles": [],
                    "current_position": '',
                    "current_company": ''
                })

        return profile_summary

    except Exception as e:
        print(f"❌ Failed to parse user profile automatically: {str(e)}")
        return None


def save_user_profile(profile: Dict[str, Any], filename: str) -> bool:
    """Save user profile to JSON file"""
    try:
        import json
        with open(filename, 'w') as f:
            # Remove detailed_data for cleaner JSON (it's too large)
            clean_profile = {k: v for k, v in profile.items() if k != 'detailed_data'}
            json.dump(clean_profile, f, indent=2)
        return True
    except Exception as e:
        print(f"⚠️ Could not save profile: {e}")
        return False


def load_user_profile(filename: str) -> Optional[Dict[str, Any]]:
    """Load user profile from JSON file"""
    try:
        import json
        with open(filename, 'r') as f:
            return json.load(f)
    except Exception:
        return None


def calculate_academic_status(schools_data) -> tuple[str, str]:
    """
    Calculate academic year (freshman/sophomore/junior/senior) and major from schools data

    Args:
        schools_data: Schools data from StaffSpy (list or JSON string)

    Returns:
        Tuple of (academic_year, major)
    """
    try:
        # Handle different data formats
        if isinstance(schools_data, str) and schools_data.startswith('['):
            import json
            schools = json.loads(schools_data)
        elif isinstance(schools_data, list):
            schools = schools_data
        else:
            return "N/A", "N/A"

        if not schools:
            return "N/A", "N/A"

        # Get the most recent/current school
        current_school = schools[0]

        # Extract degree/major information
        degree = current_school.get('degree', '')
        major = "N/A"

        # Extract major from degree string
        if degree:
            # Common patterns: "Bachelor of Science - BS, Computer Science"
            if 'computer science' in degree.lower() or 'cs' in degree.lower():
                major = "Computer Science"
            elif 'engineering' in degree.lower():
                major = "Engineering"
            elif 'business' in degree.lower():
                major = "Business"
            elif 'mathematics' in degree.lower() or 'math' in degree.lower():
                major = "Mathematics"
            else:
                # Try to extract after comma or dash
                parts = degree.replace(' - ', ',').split(',')
                if len(parts) > 1:
                    major = parts[-1].strip()

        # Calculate academic year based on start/end dates
        start_date = current_school.get('start_date', '')
        end_date = current_school.get('end_date', '')

        if start_date:
            try:
                # Parse date (format: YYYY-MM-DD)
                from datetime import datetime
                start_year = int(start_date.split('-')[0])
                current_year = datetime.now().year
                years_elapsed = current_year - start_year

                # Map years to academic status
                if years_elapsed <= 1:
                    academic_year = "Freshman"
                elif years_elapsed == 2:
                    academic_year = "Sophomore"
                elif years_elapsed == 3:
                    academic_year = "Junior"
                elif years_elapsed >= 4:
                    academic_year = "Senior"
                else:
                    academic_year = "N/A"

            except (ValueError, IndexError):
                academic_year = "N/A"
        else:
            academic_year = "N/A"

        return academic_year, major

    except Exception as e:
        print(f"⚠️ Error calculating academic status: {e}")
        return "N/A", "N/A"


if __name__ == "__main__":
    # Test LinkedIn authentication and scraping
    print("🔧 Testing LinkedIn authentication and scraping...")

    try:
        # Step 1: Initialize account with browser authentication
        print("📝 Step 1: Initializing LinkedIn account...")
        account = init_account()
        print("✅ LinkedIn account initialized successfully")

        # Step 2: Test scraping with sample parameters
        print("📝 Step 2: Testing company staff scraping...")

        # Test parameters
        test_company = "Meta"
        test_role = "Software Engineer"
        test_location = "USA"
        test_max_results = 5  # Small number for testing

        print(f"🔍 Scraping: {test_role} at {test_company} in {test_location} (max: {test_max_results})")

        csv_file = scrape_company_staff(
            account=account,
            company_name=test_company,
            search_term=test_role,
            location=test_location,
            max_results=test_max_results
        )

        print(f"✅ Scraping completed successfully!")
        print(f"📄 CSV file created: {csv_file}")

    except Exception as e:
        print(f"❌ Test failed: {str(e)}")
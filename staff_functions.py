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
            log_level=0,  # 0 for no logs
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


def send_personalized_message_to_connection(
    account: LinkedInAccount,
    connection_profile_url: str,
    personalized_message: str,
    connect_if_not_connected: bool = True
) -> Dict[str, Any]:
    """
    Send a personalized message to a specific LinkedIn connection using browser automation

    Args:
        account: Authenticated LinkedInAccount with browser session
        connection_profile_url: LinkedIn profile URL (e.g., "https://linkedin.com/in/username")
        personalized_message: The message to send
        connect_if_not_connected: Whether to send connection request if not already connected

    Returns:
        Dictionary with success status and details
    """
    try:
        from selenium.webdriver.common.by import By
        from selenium.webdriver.support.ui import WebDriverWait
        from selenium.webdriver.support import expected_conditions as EC
        from selenium.common.exceptions import TimeoutException, NoSuchElementException
        import time

        # Extract username from LinkedIn URL
        import re
        username_match = re.search(r'linkedin\.com/in/([^/?]+)', connection_profile_url)
        if not username_match:
            return {
                "success": False,
                "error": "Invalid LinkedIn URL format",
                "profile_url": connection_profile_url
            }

        username = username_match.group(1)
        print(f"🎯 Targeting user: {username}")

        # Check if we have a browser session (StaffSpy should have one)
        if not hasattr(account, 'session') or not account.session:
            return {
                "success": False,
                "error": "No active browser session found",
                "profile_url": connection_profile_url
            }

        # First, let's try to get the user's profile data to check connection status
        try:
            user_profiles = account.scrape_users([username], extra_profile_data=True)
            if user_profiles.empty:
                return {
                    "success": False,
                    "error": "Could not find user profile",
                    "profile_url": connection_profile_url
                }

            user_data = user_profiles.iloc[0].to_dict()
            connection_status = user_data.get('is_connection', 'no')
            print(f"📊 Connection status: {connection_status}")

        except Exception as e:
            print(f"⚠️ Could not check connection status: {e}")
            connection_status = 'unknown'

        # If not connected and we should connect first
        if connection_status == 'no' and connect_if_not_connected:
            print("🤝 Sending connection request first...")
            try:
                # Use StaffSpy's connect functionality
                from staffspy.utils.models import Staff

                # Create a Staff object for the connection
                staff_obj = Staff()
                staff_obj.id = username
                staff_obj.urn = user_data.get('urn', username)
                staff_obj.is_connection = 'no'
                staff_obj.profile_link = connection_profile_url

                # Use the LinkedIn scraper's connect method
                linkedin_scraper = account._scraper if hasattr(account, '_scraper') else None
                if linkedin_scraper:
                    linkedin_scraper.connect_user(staff_obj)
                    print("✅ Connection request sent")

                    # Wait a bit before trying to message
                    time.sleep(2)
                else:
                    print("⚠️ Could not access LinkedIn scraper for connection")

            except Exception as e:
                print(f"⚠️ Failed to send connection request: {e}")

        # Now use browser automation to send the message
        # We'll use LinkedIn's messaging API endpoint directly through the session
        try:
            # Get the member ID for messaging
            member_id = user_data.get('urn', username)
            if not member_id:
                return {
                    "success": False,
                    "error": "Could not get member ID for messaging",
                    "profile_url": connection_profile_url
                }

            # LinkedIn messaging endpoint
            messaging_endpoint = "https://www.linkedin.com/voyager/api/messaging/conversations"

            # Prepare message data
            message_data = {
                "keyVersion": "LEGACY_INBOX",
                "conversationCreate": {
                    "eventCreate": {
                        "value": {
                            "com.linkedin.voyager.messaging.create.MessageCreate": {
                                "body": personalized_message,
                                "attachments": [],
                                "attributedBody": {
                                    "text": personalized_message,
                                    "attributes": []
                                }
                            }
                        }
                    },
                    "recipients": [f"urn:li:member:{member_id}"],
                    "subtype": "MEMBER_TO_MEMBER"
                }
            }

            # Set appropriate headers
            headers = {
                "Content-Type": "application/json",
                "csrf-token": account.session.cookies.get("JSESSIONID", ""),
                "x-li-lang": "en_US",
                "x-restli-protocol-version": "2.0.0"
            }

            # Send the message
            response = account.session.post(
                messaging_endpoint,
                json=message_data,
                headers=headers
            )

            if response.status_code == 201:
                print("✅ Message sent successfully!")
                return {
                    "success": True,
                    "message": "Message sent successfully",
                    "profile_url": connection_profile_url,
                    "username": username,
                    "connection_status": connection_status,
                    "message_preview": personalized_message[:100] + "..." if len(personalized_message) > 100 else personalized_message
                }
            else:
                print(f"❌ Failed to send message. Status: {response.status_code}")
                print(f"Response: {response.text[:200]}")

                return {
                    "success": False,
                    "error": f"Failed to send message. Status: {response.status_code}",
                    "profile_url": connection_profile_url,
                    "response_code": response.status_code
                }

        except Exception as e:
            print(f"❌ Error sending message: {e}")
            return {
                "success": False,
                "error": f"Error sending message: {str(e)}",
                "profile_url": connection_profile_url
            }

    except Exception as e:
        print(f"❌ General error: {e}")
        return {
            "success": False,
            "error": f"General error: {str(e)}",
            "profile_url": connection_profile_url
        }


def generate_and_send_personalized_message(
    username: str,
    password: str,
    target_profile_url: str,
    tone: str = 'warm',
    connect_if_needed: bool = True,
    session_file: str = "session.pkl"
) -> Dict[str, Any]:
    """
    Complete workflow: authenticate, generate personalized message, and send it

    Args:
        username: LinkedIn username/email
        password: LinkedIn password
        target_profile_url: Target's LinkedIn profile URL
        tone: Message tone ('warm', 'concise', 'direct', 'curious')
        connect_if_needed: Whether to send connection request if not connected
        session_file: Session file for persistence

    Returns:
        Dictionary with results and metadata
    """
    try:
        # Step 1: Initialize account
        print("🔐 Initializing LinkedIn account...")
        account = init_account(username, password, session_file)

        if not account.user_profile:
            return {
                "success": False,
                "error": "Could not load sender profile data",
                "step": "profile_loading"
            }

        # Step 2: Get target profile data
        print("🎯 Loading target profile...")
        import re
        username_match = re.search(r'linkedin\.com/in/([^/?]+)', target_profile_url)
        if not username_match:
            return {
                "success": False,
                "error": "Invalid LinkedIn URL format",
                "target_url": target_profile_url
            }

        target_username = username_match.group(1)

        try:
            target_profiles = account.scrape_users([target_username], extra_profile_data=True)
            if target_profiles.empty:
                return {
                    "success": False,
                    "error": "Could not find target profile",
                    "target_url": target_profile_url
                }

            target_data = target_profiles.iloc[0].to_dict()
        except Exception as e:
            return {
                "success": False,
                "error": f"Failed to load target profile: {str(e)}",
                "target_url": target_profile_url
            }

        # Step 3: Generate personalized message using AI
        print("🤖 Generating personalized message...")
        try:
            # Convert data to the format expected by the drafting service
            sender_profile = {
                "name": account.user_profile.get('name', ''),
                "headline": account.user_profile.get('headline', ''),
                "current_company": account.user_profile.get('current_company', ''),
                "university": account.user_profile.get('university', ''),
                "summary": account.user_profile.get('headline', ''),
                "skills": account.user_profile.get('skills', []),
                "experiences": account.user_profile.get('experience', []),
                "schools": account.user_profile.get('education', [])
            }

            receiver_profile = {
                "name": target_data.get('name', ''),
                "title": target_data.get('current_position', ''),
                "company": target_data.get('current_company', ''),
                "location": target_data.get('location', ''),
                "summary": target_data.get('bio', ''),
                "skills": target_data.get('skills', ''),
                "schools": target_data.get('schools', ''),
                "experience": target_data.get('experiences', '')
            }

            # Use a simple template for now (could integrate with Gemini API later)
            personalized_message = generate_simple_personalized_message(
                sender_profile, receiver_profile, tone
            )

        except Exception as e:
            print(f"⚠️ AI generation failed, using template: {e}")
            personalized_message = f"""Hi {target_data.get('name', 'there')},

I hope you're doing well! I came across your profile and was impressed by your background at {target_data.get('current_company', 'your company')}.

As someone working in {account.user_profile.get('current_company', 'the field')}, I'd love to connect and learn more about your experience.

Best regards,
{account.user_profile.get('name', 'Your connection')}"""

        print(f"📝 Generated message: {personalized_message[:100]}...")

        # Step 4: Send the message
        print("📤 Sending message...")
        result = send_personalized_message_to_connection(
            account=account,
            connection_profile_url=target_profile_url,
            personalized_message=personalized_message,
            connect_if_not_connected=connect_if_needed
        )

        # Add metadata to result
        result.update({
            "sender_name": account.user_profile.get('name', ''),
            "target_name": target_data.get('name', ''),
            "message_tone": tone,
            "full_message": personalized_message
        })

        return result

    except Exception as e:
        return {
            "success": False,
            "error": f"Workflow error: {str(e)}",
            "target_url": target_profile_url
        }


def generate_simple_personalized_message(sender_profile: Dict, receiver_profile: Dict, tone: str = 'warm') -> str:
    """
    Generate a simple personalized message based on profiles
    """
    sender_name = sender_profile.get('name', 'Your connection')
    receiver_name = receiver_profile.get('name', 'there')
    receiver_company = receiver_profile.get('company', 'your company')
    receiver_title = receiver_profile.get('title', 'your role')
    sender_company = sender_profile.get('current_company', '')
    sender_university = sender_profile.get('university', '')

    # Find common ground
    common_ground = []

    # Check for same company
    if sender_company and receiver_company and sender_company.lower() in receiver_company.lower():
        common_ground.append(f"we both have connections to {receiver_company}")

    # Check for same university
    receiver_schools = receiver_profile.get('schools', '').lower()
    if sender_university and sender_university.lower() in receiver_schools:
        common_ground.append(f"we're both connected to {sender_university}")

    # Generate message based on tone
    if tone == 'concise':
        message = f"""Hi {receiver_name},

I noticed your background in {receiver_title} at {receiver_company}. Would love to connect!

Best,
{sender_name}"""

    elif tone == 'direct':
        message = f"""Hi {receiver_name},

I'm reaching out regarding your role as {receiver_title} at {receiver_company}. I'm interested in connecting with professionals in your field.

Best regards,
{sender_name}"""

    elif tone == 'curious':
        message = f"""Hi {receiver_name},

I came across your profile and was curious about your work as {receiver_title} at {receiver_company}. Your background looks really interesting!

{f"I noticed {common_ground[0]} - small world!" if common_ground else ""}

Would love to connect and learn more about your experience.

Best,
{sender_name}"""

    else:  # warm (default)
        message = f"""Hi {receiver_name},

I hope you're doing well! I came across your profile and was impressed by your background as {receiver_title} at {receiver_company}.

{f"I also noticed that {common_ground[0]} - it's a small world!" if common_ground else ""}

I'd love to connect and potentially learn more about your experience in the field.

Best regards,
{sender_name}"""

    return message


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
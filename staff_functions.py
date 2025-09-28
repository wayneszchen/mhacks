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


def init_account(username: str, password: str, session_file: str = "session.pkl") -> LinkedInAccount:
    """Initialize LinkedIn account with credentials"""
    try:
        account = LinkedInAccount(
            username=username,
            password=password,
            session_file=session_file,
            log_level=1,  # 0 for no logs
        )
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


if __name__ == "__main__":
    # CLI interface for testing
    if len(sys.argv) < 5:
        print("Usage: python staff_functions.py <username> <password> <company> '<role>' [location] [max_results]")
        print("Example: python staff_functions.py user@email.com password123 Amazon 'Software Engineer' USA 20")
        sys.exit(1)
    
    username = sys.argv[1]
    password = sys.argv[2]
    company = sys.argv[3]
    
    # Handle multi-word roles and optional parameters
    if len(sys.argv) == 5:
        # Only 4 args: assume role is single word, use defaults
        role = sys.argv[4]
        location = "USA"
        max_results = 20
    elif len(sys.argv) == 6:
        # 5 args: could be role + location OR role + max_results
        role = sys.argv[4]
        try:
            # Try to parse as max_results (number)
            max_results = int(sys.argv[5])
            location = "USA"
        except ValueError:
            # Not a number, treat as location
            location = sys.argv[5]
            max_results = 20
    elif len(sys.argv) == 7:
        # 6 args: role + location + max_results
        role = sys.argv[4]
        location = sys.argv[5]
        max_results = int(sys.argv[6])
    else:
        # More than 6 args: combine middle args as multi-word role
        role_parts = sys.argv[4:-2] if len(sys.argv) > 6 else [sys.argv[4]]
        role = " ".join(role_parts)
        location = sys.argv[-2] if len(sys.argv) > 6 else "USA"
        try:
            max_results = int(sys.argv[-1])
        except ValueError:
            max_results = 20
    
    print(f"🔍 Searching for: {role} at {company} in {location} (max: {max_results})")
    result = extract_staff_data(username, password, company, role, location, max_results)
    print(json.dumps(result, indent=2))

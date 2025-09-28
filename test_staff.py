#!/usr/bin/env python3
"""
Test script for staff_functions.py
"""

from staff_functions import extract_staff_data, parse_search_prompt
import json

def test_prompt_parsing():
    """Test the prompt parsing function"""
    test_prompts = [
        "Find SWE contacts at Amazon in Seattle",
        "Find software engineer contacts at Google in San Francisco",
        "Find product manager contacts at Microsoft",
        "Find data scientist contacts at OpenAI in USA"
    ]
    
    print("Testing prompt parsing:")
    for prompt in test_prompts:
        result = parse_search_prompt(prompt)
        print(f"'{prompt}' -> {result}")
    print()

def test_extraction():
    """Test the full extraction workflow (requires real credentials)"""
    print("To test the full extraction, run:")
    print("python3 staff_functions.py <email> <password> <company> <role> [location] [max_results]")
    print()
    print("Example:")
    print("python3 staff_functions.py your-email@example.com your-password OpenAI 'software engineer' USA 5")

if __name__ == "__main__":
    test_prompt_parsing()
    test_extraction()

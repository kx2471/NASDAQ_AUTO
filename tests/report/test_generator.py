# tests/report/test_generator.py
import pytest
from autotrader.report.generator import ReportGenerator
from autotrader.config import config

def test_generate_markdown_report(tmp_path):
    """
    Tests that a markdown report is generated correctly.
    """
    # Temporarily change REPORTS_DIR for testing
    original_reports_dir = config.REPORTS_DIR
    config.REPORTS_DIR = tmp_path

    generator = ReportGenerator()
    title = "Test Report"
    content = "This is a test report content."
    filename = "test_report"

    filepath = generator.generate_markdown_report(title, content, filename)

    assert (tmp_path / f"{filename}.md").exists()
    with open(filepath, 'r', encoding='utf-8') as f:
        read_content = f.read()
    assert f"# {title}" in read_content
    assert content in read_content

    # Restore original REPORTS_DIR
    config.REPORTS_DIR = original_reports_dir

def test_convert_markdown_to_pdf(tmp_path):
    """
    Tests that a markdown file is converted to PDF.
    """
    # Temporarily change REPORTS_DIR for testing
    original_reports_dir = config.REPORTS_DIR
    config.REPORTS_DIR = tmp_path

    generator = ReportGenerator()
    md_filename = "test_md_for_pdf.md"
    pdf_filename = "test_pdf_output"
    md_filepath = tmp_path / md_filename

    with open(md_filepath, 'w', encoding='utf-8') as f:
        f.write("# Hello PDF\n\nThis is a test.")

    pdf_output_path = generator.convert_markdown_to_pdf(str(md_filepath), pdf_filename)

    assert (tmp_path / f"{pdf_filename}.pdf").exists()
    assert pdf_output_path is not None

    # Restore original REPORTS_DIR
    config.REPORTS_DIR = original_reports_dir

# autotrader/report/render.py
import markdown
from reportlab.lib.pagesizes import letter
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer
from reportlab.lib.styles import getSampleStyleSheet
from autotrader.storage.paths import REPORTS_DIR
from autotrader.utils.logging import get_main_logger

logger = get_main_logger(__name__)

class ReportRenderer:
    """
    Renders trading reports in Markdown and PDF formats.
    """
    def render_markdown_report(self, title: str, content: str, filename: str) -> str:
        """
        Renders a Markdown report and saves it to the reports directory.
        """
        filepath = REPORTS_DIR / f"{filename}.md"
        full_content = f"# {title}\n\n{content}"
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(full_content)
        logger.info(f"Markdown report rendered: {filepath}")
        return str(filepath)

    def render_markdown_to_pdf(self, markdown_filepath: str, pdf_filename: str):
        """
        Renders a Markdown file to a PDF file.
        """
        pdf_filepath = REPORTS_DIR / f"{pdf_filename}.pdf"
        
        with open(markdown_filepath, 'r', encoding='utf-8') as f:
            md_content = f.read()

        # Convert markdown to HTML (basic conversion)
        html_content = markdown.markdown(md_content)

        doc = SimpleDocTemplate(str(pdf_filepath), pagesize=letter)
        styles = getSampleStyleSheet()
        story = []

        # This is a very basic HTML to PDF conversion. For complex HTML, 
        # you might need a more robust library like WeasyPrint or wkhtmltopdf.
        # For simplicity, we'll just add paragraphs from the text content.
        for line in html_content.split('\n'):
            if line.strip():
                story.append(Paragraph(line, styles['Normal']))
                story.append(Spacer(1, 0.2 * 2.54 * 72)) # Add some space

        try:
            doc.build(story)
            logger.info(f"PDF report rendered: {pdf_filepath}")
            return str(pdf_filepath)
        except Exception as e:
            logger.error(f"Error rendering PDF: {e}")
            return None
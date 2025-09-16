"""
Report data models
"""
from datetime import datetime
from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field
from enum import Enum

class AgentType(str, Enum):
    """AI Agent types"""
    GPT = "gpt"
    CLAUDE = "claude"
    GEMINI = "gemini"
    MANAGER = "manager"

class ReportType(str, Enum):
    """Report types"""
    WEEKLY_AGENT = "weekly_agent"
    UNIFIED = "unified"
    MANAGER_FINAL = "manager_final"

class ReportFormat(str, Enum):
    """Report formats"""
    MARKDOWN = "md"
    HTML = "html"
    JSON = "json"

class AgentReport(BaseModel):
    """Individual agent report"""
    agent_type: AgentType = Field(..., description="Agent type")
    content: str = Field(..., description="Report content")
    generation_time: datetime = Field(default_factory=datetime.now, description="Generation timestamp")
    model_used: Optional[str] = Field(None, description="AI model used")
    token_usage: Optional[Dict[str, int]] = Field(None, description="Token usage statistics")
    success: bool = Field(default=True, description="Generation success status")
    error_message: Optional[str] = Field(None, description="Error message if failed")

class UnifiedReport(BaseModel):
    """Unified report combining multiple agents"""
    report_type: ReportType = Field(..., description="Report type")
    format: ReportFormat = Field(..., description="Report format")
    content: str = Field(..., description="Report content")
    generation_time: datetime = Field(default_factory=datetime.now, description="Generation timestamp")

    # Source reports
    source_agents: List[AgentType] = Field(default_factory=list, description="Source agent types")
    agent_reports: List[AgentReport] = Field(default_factory=list, description="Source agent reports")

    # Metadata
    portfolio_snapshot: Optional[Dict[str, Any]] = Field(None, description="Portfolio state at report time")
    market_data_timestamp: Optional[datetime] = Field(None, description="Market data timestamp")
    performance_metrics: Optional[Dict[str, Any]] = Field(None, description="Performance metrics")

class ManagerReport(BaseModel):
    """Manager agent final report"""
    content: str = Field(..., description="Final report content")
    generation_time: datetime = Field(default_factory=datetime.now, description="Generation timestamp")

    # Decision metrics
    recommended_actions: List[Dict[str, Any]] = Field(default_factory=list, description="Recommended trading actions")
    risk_assessment: Optional[Dict[str, Any]] = Field(None, description="Risk assessment")
    confidence_score: Optional[float] = Field(None, ge=0, le=1, description="Confidence score")

    # Source data
    source_reports: List[AgentReport] = Field(default_factory=list, description="Source agent reports")
    consensus_analysis: Optional[Dict[str, Any]] = Field(None, description="Consensus analysis across agents")

class ReportMetadata(BaseModel):
    """Report file metadata"""
    filename: str = Field(..., description="Report filename")
    file_path: str = Field(..., description="Full file path")
    report_type: ReportType = Field(..., description="Report type")
    format: ReportFormat = Field(..., description="Report format")
    agent_type: Optional[AgentType] = Field(None, description="Agent type (for agent reports)")
    generation_time: datetime = Field(..., description="Generation timestamp")
    file_size: Optional[int] = Field(None, description="File size in bytes")
    checksum: Optional[str] = Field(None, description="File checksum")

class EmailReport(BaseModel):
    """Email report configuration"""
    subject: str = Field(..., description="Email subject")
    recipient: str = Field(..., description="Recipient email")
    html_content: str = Field(..., description="HTML email content")
    markdown_content: Optional[str] = Field(None, description="Markdown content")
    attachments: List[str] = Field(default_factory=list, description="Attachment file paths")
    sent_at: Optional[datetime] = Field(None, description="Send timestamp")
    success: bool = Field(default=False, description="Send success status")
    error_message: Optional[str] = Field(None, description="Error message if failed")

class ReportJob(BaseModel):
    """Report generation job"""
    job_id: str = Field(..., description="Unique job ID")
    job_type: str = Field(..., description="Job type (weekly, manager, etc.)")
    status: str = Field(default="pending", description="Job status")
    created_at: datetime = Field(default_factory=datetime.now, description="Creation timestamp")
    started_at: Optional[datetime] = Field(None, description="Start timestamp")
    completed_at: Optional[datetime] = Field(None, description="Completion timestamp")

    # Job configuration
    agents_to_run: List[AgentType] = Field(default_factory=list, description="Agents to run")
    generate_email: bool = Field(default=True, description="Whether to generate email")
    save_reports: bool = Field(default=True, description="Whether to save reports")

    # Results
    generated_reports: List[ReportMetadata] = Field(default_factory=list, description="Generated reports")
    email_reports: List[EmailReport] = Field(default_factory=list, description="Email reports")
    error_messages: List[str] = Field(default_factory=list, description="Error messages")

    @property
    def duration(self) -> Optional[float]:
        """Calculate job duration in seconds"""
        if self.started_at and self.completed_at:
            return (self.completed_at - self.started_at).total_seconds()
        return None

class ReportingConfig(BaseModel):
    """Reporting configuration"""

    # Schedule configuration
    weekly_schedule: str = Field(default="0 6 * * 1", description="Weekly report cron schedule (UTC)")
    manager_schedule: str = Field(default="0 7 * * 1", description="Manager report cron schedule (UTC)")

    # Agent configuration
    enabled_agents: List[AgentType] = Field(
        default=[AgentType.GPT, AgentType.CLAUDE, AgentType.GEMINI],
        description="Enabled AI agents"
    )

    # Email configuration
    email_enabled: bool = Field(default=True, description="Enable email reports")
    email_template: str = Field(default="default", description="Email template to use")

    # File storage configuration
    save_markdown: bool = Field(default=True, description="Save markdown reports")
    save_html: bool = Field(default=True, description="Save HTML reports")
    save_json: bool = Field(default=False, description="Save JSON reports")

    # Retention configuration
    retention_days: int = Field(default=90, description="Report retention period in days")
    max_reports_per_type: int = Field(default=100, description="Maximum reports per type to keep")
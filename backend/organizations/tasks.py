from celery import shared_task


@shared_task
def generate_monthly_invoices():
    from organizations.services import generate_last_month_invoices

    return len(generate_last_month_invoices())

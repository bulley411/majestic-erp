import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';
import { ZodError } from 'zod';

/**
 * Without this, a Zod parse failure escapes as a 500 and the form has
 * nothing useful to show. This turns it into a 400 carrying field paths,
 * which the client maps onto the offending inputs.
 */
@Catch(ZodError)
export class ZodExceptionFilter implements ExceptionFilter {
  catch(error: ZodError, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const fieldErrors: Record<string, string> = {};
    for (const issue of error.issues) {
      const path = issue.path.join('.') || '_';
      if (!fieldErrors[path]) fieldErrors[path] = issue.message;
    }
    res.status(400).json({
      statusCode: 400,
      message: 'Please correct the highlighted fields.',
      fieldErrors,
    });
  }
}

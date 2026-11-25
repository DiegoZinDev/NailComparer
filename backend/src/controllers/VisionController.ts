import type { NextFunction, Request, Response } from 'express';
import { ReferenceVisionService } from '../services/ReferenceVisionService.js';

export class VisionController {
  private readonly referenceVisionService: ReferenceVisionService;

  constructor(referenceVisionService = new ReferenceVisionService()) {
    this.referenceVisionService = referenceVisionService;
  }

  reconstructReference = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const result = await this.referenceVisionService.reconstructReference(req.body);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };
}

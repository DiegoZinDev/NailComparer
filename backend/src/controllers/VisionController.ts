import type { NextFunction, Request, Response } from 'express';
import { NailReconstructionService } from '../services/NailReconstructionService.js';

export class VisionController {
  private readonly nailReconstructionService: NailReconstructionService;

  constructor(nailReconstructionService = new NailReconstructionService()) {
    this.nailReconstructionService = nailReconstructionService;
  }

  reconstructNail = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const result = await this.nailReconstructionService.reconstructNail(
        req.body,
        req.headers
      );
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };
}

import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { VouchersService } from './vouchers.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller()
@UseGuards(JwtAuthGuard)
export class VouchersController {
  constructor(private readonly v: VouchersService) {}

  @Post('municipal-programs')
  createProgram(@Body() body: any) { return this.v.createProgram(body); }

  @Get('municipal-programs')
  listPrograms() { return this.v.listPrograms(); }

  @Post('vouchers')
  createVoucher(@Body() body: any) { return this.v.createVoucher(body); }

  @Get('vouchers')
  listVouchers() { return this.v.listVouchers(); }

  @Get('vouchers/:id')
  getVoucher(@Param('id') id: string) { return this.v.getVoucher(id); }

  @Post('vouchers/:id/reserve')
  reserve(@Param('id') id: string, @Body() body: any) { return this.v.reserve(id, body.tripId, body.amountCents); }

  @Post('vouchers/:id/consume')
  consume(@Param('id') id: string, @Body() body: any) { return this.v.consume(id, body.tripId, body.amountCents); }

  @Post('vouchers/:id/release')
  release(@Param('id') id: string, @Body() body: any) { return this.v.release(id, body.tripId, body.amountCents); }
}
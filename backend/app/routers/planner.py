from fastapi import APIRouter, HTTPException
from app.planner import Plan, PlanRequest, split_route

router = APIRouter(tags=['planner'])


@router.post('/plan', response_model=Plan)
def plan_route(payload: PlanRequest) -> Plan:
    try:
        return split_route(payload)
    except (ValueError, OverflowError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
